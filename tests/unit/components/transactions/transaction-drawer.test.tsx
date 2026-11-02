import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TransactionDrawer,
  type TransactionDrawerHandle,
} from '@/components/transactions/transaction-drawer';
import type { Category, Tx } from '@/components/transactions/types';
import { triggerSync } from '@/lib/cloud-sync';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

const base: Tx = {
  id: 't1',
  date: '2026-03-04T00:00:00.000Z',
  merchant: 'Test Merchant',
  amount: -42.5,
  category: { id: 'c1', name: 'Test A' },
  account: { id: 'a1', name: 'Test Card' },
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
};

const list: Tx[] = [
  base,
  { ...base, id: 't2', merchant: 'Test Merchant 2' },
  { ...base, id: 't3', merchant: 'Test Merchant 3' },
];

const categories: Category[] = [
  { id: 'g1', name: 'Group', type: 'expense', parentId: null },
  { id: 'c1', name: 'Test A', type: 'expense', parentId: 'g1' },
];

const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
const fetchMock = () => vi.mocked(global.fetch);
const calls = () =>
  fetchMock().mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${url}`);

type Props = Parameters<typeof TransactionDrawer>[0];

function setup(state: Props['state'], log: string[] = []) {
  const ref = createRef<TransactionDrawerHandle>();
  const props = {
    onOpen: vi.fn((id: string) => void log.push(`open ${id}`)),
    onNew: vi.fn(() => void log.push('new')),
    onClose: vi.fn(),
    onRowSaved: vi.fn(),
    onChanged: vi.fn(),
    onCreated: vi.fn(),
  };
  render(
    <TransactionDrawer
      ref={ref}
      accounts={[{ id: 'a1', name: 'Test Card' }]}
      availableTags={[]}
      baseCurrency="USD"
      categories={categories}
      list={list}
      state={state}
      onCreateTag={vi.fn().mockResolvedValue(null)}
      {...props}
    />
  );
  return { ...props, ref };
}

const edit = (tx: Tx): Props['state'] => ({ mode: 'edit', tx });

describe('TransactionDrawer', () => {
  beforeEach(() => {
    vi.mocked(triggerSync).mockClear();
    global.fetch = vi.fn().mockResolvedValue(reply({})) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows position and steps to the next transaction', async () => {
    const { onOpen } = setup(edit(list[0]));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByText('2026-03-04 · Test Card')).toBeInTheDocument();
    expect(screen.getByText('−$42.50')).toBeInTheDocument();
    expect(screen.getByText('72% confident')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next transaction' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('t2'));
  });

  it('flushes pending edit before stepping', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const log: string[] = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      log.push(`${init.method} ${url}`);
      return reply({});
    }) as unknown as typeof fetch;
    const { onOpen } = setup(edit(list[0]), log);
    await user.type(screen.getByLabelText('Merchant'), 'X');
    await user.click(screen.getByRole('button', { name: 'Next transaction' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('t2'));
    expect(log).toEqual(['PATCH /api/transactions/t1', 'open t2']);
  });

  it('stays put when the flush fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ error: 'nope' }, false)) as typeof fetch;
    const { onOpen, onClose } = setup(edit(list[0]));
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Next transaction' }));
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(2));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes after a successful flush', async () => {
    const { onClose } = setup(edit(list[0]));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('ignores arrow keys while typing', async () => {
    const { onOpen } = setup(edit(list[0]));
    await userEvent.click(screen.getByLabelText('Note'));
    await userEvent.keyboard('{ArrowDown}');
    expect(onOpen).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('t2'));
  });

  it('autosave patches only the merchant and updates the row', async () => {
    const { onRowSaved, onChanged } = setup(edit(list[0]));
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    await waitFor(() => expect(onRowSaved).toHaveBeenCalled(), { timeout: 2000 });
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions/t1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      merchant: 'Test MerchantX',
    });
    expect(onRowSaved).toHaveBeenCalledWith('t1', { merchant: 'Test MerchantX' });
    expect(onChanged).not.toHaveBeenCalled();
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('transfer switch triggers a full refresh', async () => {
    const { onChanged } = setup(edit(list[0]));
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls()).toEqual(['PATCH /api/transactions/t1']);
    // A changed transfer status drops any pairing so sync can pair it afresh.
    const init = fetchMock().mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ isTransfer: true, transferGroupId: null });
  });

  it('split parts have no delete and show the summary', () => {
    setup(
      edit({
        ...list[0],
        parentTransactionId: 'parent',
        parentTransaction: {
          id: 'parent',
          amount: -100,
          merchant: 'Test Merchant',
          splitParts: [
            { id: 't1', amount: -42.5, categoryId: 'c1', note: null },
            { id: 'p2', amount: -57.5, categoryId: null, note: null },
          ],
        },
      })
    );
    expect(screen.getByText('Part of a split · −$100.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete transaction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '⑂ Split' })).not.toBeInTheDocument();
  });

  it('unsplit restores the original and opens it', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ id: 'parent' })) as unknown as typeof fetch;
    const { onOpen, onChanged } = setup(
      edit({
        ...list[0],
        parentTransactionId: 'parent',
        parentTransaction: { id: 'parent', amount: -100, merchant: 'Test Merchant' },
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('parent'));
    expect(onChanged).toHaveBeenCalled();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions/unsplit');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      transactionId: 'parent',
    });
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('split saved refreshes and opens the first part', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(reply({ parts: [{ id: 'p1' }, { id: 'p2' }] })) as unknown as typeof fetch;
    const { onOpen, onChanged } = setup(edit(list[0]));
    await userEvent.click(screen.getByRole('button', { name: '⑂ Split' }));
    await userEvent.clear(screen.getByLabelText('Part 1 amount'));
    await userEvent.type(screen.getByLabelText('Part 1 amount'), '40');
    await userEvent.type(screen.getByLabelText('Part 2 amount'), '2.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save split' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('flushes a pending edit before opening the split editor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const log: string[] = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      log.push(`${init.method} ${url}`);
      // The editor must not be showing yet when the PATCH goes out.
      if (screen.queryByLabelText('Part 1 amount')) log.push('editor open');
      return reply({});
    }) as unknown as typeof fetch;
    setup(edit(list[0]), log);
    await user.type(screen.getByLabelText('Merchant'), 'X');
    await user.click(screen.getByRole('button', { name: '⑂ Split' }));
    expect(await screen.findByLabelText('Part 1 amount')).toBeInTheDocument();
    expect(log).toEqual(['PATCH /api/transactions/t1']);
  });

  it('saves an edit made in the split editor before posting the split', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const log: string[] = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      log.push(`${init.method} ${url}`);
      return reply({ parts: [{ id: 'p1' }, { id: 'p2' }] });
    }) as unknown as typeof fetch;
    const { onOpen } = setup(edit(list[0]), log);
    await user.click(screen.getByRole('button', { name: '⑂ Split' }));
    await user.clear(await screen.findByLabelText('Part 1 amount'));
    await user.type(screen.getByLabelText('Part 1 amount'), '40');
    await user.type(screen.getByLabelText('Part 2 amount'), '2.50');
    await user.type(screen.getByLabelText('Merchant'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save split' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p1'));
    expect(log).toEqual(['PATCH /api/transactions/t1', 'POST /api/transactions/split', 'open p1']);
  });

  it('does not post the split when saving the pending edit fails', async () => {
    global.fetch = vi.fn(async (url: string) =>
      url === '/api/transactions/t1' ? reply({ error: 'nope' }, false) : reply({ parts: [] })
    ) as unknown as typeof fetch;
    setup(edit(list[0]));
    await userEvent.click(screen.getByRole('button', { name: '⑂ Split' }));
    await userEvent.clear(screen.getByLabelText('Part 1 amount'));
    await userEvent.type(screen.getByLabelText('Part 1 amount'), '40');
    await userEvent.type(screen.getByLabelText('Part 2 amount'), '2.50');
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Save split' }));
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
    expect(calls()).not.toContain('POST /api/transactions/split');
    expect(screen.getByRole('button', { name: 'Save split' })).toBeEnabled();
  });

  it('keeps the split editor closed when the flush fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ error: 'nope' }, false)) as typeof fetch;
    setup(edit(list[0]));
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    await userEvent.click(screen.getByRole('button', { name: '⑂ Split' }));
    expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Part 1 amount')).not.toBeInTheDocument();
  });

  it('opening a row from the page flushes the pending edit first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const log: string[] = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      log.push(`${init.method} ${url}`);
      return reply({});
    }) as unknown as typeof fetch;
    const { ref, onOpen } = setup(edit(list[0]), log);
    await user.type(screen.getByLabelText('Merchant'), 'X');
    await act(() => ref.current!.open('t3', { startLinking: true }));
    expect(log).toEqual(['PATCH /api/transactions/t1', 'open t3']);
    expect(onOpen).toHaveBeenCalledWith('t3', { startLinking: true });
  });

  it('opening a row from the page stays put when the flush fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ error: 'nope' }, false)) as typeof fetch;
    const { ref, onOpen } = setup(edit(list[0]));
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    await act(() => ref.current!.open('t2'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
  });

  it('openNew flushes the pending edit first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const log: string[] = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      log.push(`${init.method} ${url}`);
      return reply({});
    }) as unknown as typeof fetch;
    const { ref } = setup(edit(list[0]), log);
    await user.type(screen.getByLabelText('Merchant'), 'X');
    await act(() => ref.current!.openNew());
    expect(log).toEqual(['PATCH /api/transactions/t1', 'new']);
  });

  it('openNew stays put when the flush fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ error: 'nope' }, false)) as typeof fetch;
    const { ref, onNew } = setup(edit(list[0]));
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    await act(() => ref.current!.openNew());
    expect(onNew).not.toHaveBeenCalled();
  });

  it('deleting a row outside the list closes the drawer', async () => {
    const { onOpen, onClose } = setup(edit({ ...base, id: 'elsewhere' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('delete opens the next row', async () => {
    const { onOpen, onChanged } = setup(edit(list[1]));
    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('t3'));
    expect(calls()).toEqual(['DELETE /api/transactions/t2']);
    expect(onChanged).toHaveBeenCalled();
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('deleting the last row opens the previous one', async () => {
    const { onOpen } = setup(edit(list[2]));
    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('t2'));
  });

  it('shows the error when delete fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(reply({ error: 'Test failure' }, false)) as typeof fetch;
    const { onOpen, onChanged } = setup(edit(list[1]));
    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Test failure')).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('new mode shows Add transaction footer', () => {
    setup({ mode: 'new' });
    expect(screen.getByText('New transaction')).toBeInTheDocument();
    expect(screen.getByText('Entered by hand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument();
    expect(screen.queryByText('1 of 3')).not.toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    setup(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
