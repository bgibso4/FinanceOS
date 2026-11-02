import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// One instance per test: the page reloads whenever the params object changes.
let params = new URLSearchParams('tab=all');
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));
vi.mock('@/components/subscriptions-tab', () => ({ SubscriptionsTab: () => null }));
vi.mock('@/components/filter-ribbon', () => ({ FilterRibbon: () => null }));

import TransactionsPage from '@/app/(routes)/transactions/page';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import type { Tx } from '@/components/transactions/types';

const t1: Tx = {
  id: 't1',
  date: '2026-03-04T00:00:00.000Z',
  merchant: 'Test Merchant 1',
  amount: -42.5,
  category: { id: 'c1', name: 'Test A' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
};
const t2: Tx = { ...t1, id: 't2', merchant: 'Test Merchant 2', amount: -10 };

type QueueFixture = {
  uncategorized: Tx[];
  lowConfidence: Tx[];
  highConfidence: Tx[];
  unlinkedReturns: Tx[];
  outliers: Tx[];
};

const emptyQueue: QueueFixture = {
  uncategorized: [],
  lowConfidence: [],
  highConfidence: [],
  unlinkedReturns: [],
  outliers: [],
};

let txList: Tx[];
let queue: QueueFixture;
let log: string[];
// When set, list GETs wait for it, holding a refresh in flight.
let listGate: Promise<void> | null;
let yearList: Tx[] | null;
// When set, PATCHes wait for it, holding a save in flight.
let patchGate: Promise<void> | null;
let failQueue: boolean;

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  params = new URLSearchParams('tab=all');
  txList = [t1, t2];
  queue = { ...emptyQueue, lowConfidence: [t1, t2] };
  log = [];
  listGate = null;
  yearList = null;
  patchGate = null;
  failQueue = false;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    log.push(`${method} ${u}`);
    if (u === '/api/transactions/unsplit') return respond({ id: 'parent' });
    if (method === 'PATCH' && patchGate) await patchGate;
    if (method !== 'GET') return respond({});
    if (listGate && (u === '/api/review-queue' || u.startsWith('/api/transactions'))) {
      await listGate;
    }
    if (u === '/api/review-queue') {
      if (failQueue) throw new Error('Test network failure');
      return respond(queue);
    }
    if (yearList && u === '/api/transactions?preset=last-12-months') {
      return respond({ transactions: yearList });
    }
    if (u === '/api/transactions' || u.startsWith('/api/transactions?')) {
      return respond({ transactions: txList });
    }
    if (/^\/api\/transactions\/[^/]+\/returns$/.test(u)) return respond({ matches: [] });
    if (u === '/api/categories') {
      return respond({
        categories: [
          { id: 'g1', name: 'Group', type: 'expense', parentId: null },
          { id: 'c1', name: 'Test A', type: 'expense', parentId: 'g1' },
        ],
      });
    }
    if (u === '/api/accounts') return respond({ accounts: [{ id: 'a1', name: 'Test Card' }] });
    if (u === '/api/settings') return respond({ settings: { baseCurrency: 'USD' } });
    if (u === '/api/tags') return respond({ tags: [] });
    return respond({});
  }) as unknown as typeof fetch;
});

const pageRoot = () =>
  screen.getByRole('heading', { level: 1, name: 'Transactions' }).parentElement!.parentElement!;
const rowFor = (merchant: string) =>
  within(screen.getByRole('table')).getByText(merchant).closest('tr')!;
const transactionGets = () =>
  log.filter((c) => c === 'GET /api/transactions' || c.startsWith('GET /api/transactions?')).length;

async function openRow(merchant: string) {
  await screen.findByText(merchant);
  await userEvent.click(within(rowFor(merchant)).getByText(merchant));
  return screen.getByRole('dialog', { name: merchant });
}

describe('Transactions page → drawer', () => {
  it('clicking a row opens the drawer and pushes the page', async () => {
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');
    expect(screen.getByRole('dialog', { name: 'Test Merchant 1' })).toBeInTheDocument();
    expect(pageRoot()).toHaveClass(DRAWER_PUSH_CLASS);
    expect(screen.getByRole('columnheader', { name: 'Account' })).toHaveClass('hidden');
  });

  it('no edit modal remains', async () => {
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('new transaction opens the drawer in new mode', async () => {
    render(<TransactionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New Transaction' }));
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument();
  });

  it('review link button opens the drawer with matches loading', async () => {
    params = new URLSearchParams('tab=review');
    render(<TransactionsPage />);
    const [link] = await screen.findAllByRole('button', { name: '🔗 Link Transaction' });
    await userEvent.click(link);
    expect(screen.getByRole('dialog', { name: 'Test Merchant 1' })).toBeInTheDocument();
    await waitFor(() => expect(log).toContain('GET /api/transactions/t1/returns'));
  });

  it('review link button shows matches when that transaction is already open', async () => {
    params = new URLSearchParams('tab=review');
    render(<TransactionsPage />);
    await userEvent.click((await screen.findAllByText('Test Merchant 1'))[0]);
    const drawer = screen.getByRole('dialog', { name: 'Test Merchant 1' });
    expect(log).not.toContain('GET /api/transactions/t1/returns');
    const [link] = screen.getAllByRole('button', { name: '🔗 Link Transaction' });
    await userEvent.click(link);
    await waitFor(() => expect(log).toContain('GET /api/transactions/t1/returns'));
    expect(within(drawer).getByText('No likely matches found.')).toBeInTheDocument();
  });

  it('review cards and bulk edit use the shared category select', async () => {
    params = new URLSearchParams('tab=review');
    const { unmount } = render(<TransactionsPage />);
    const [cardSelect] = await screen.findAllByRole('combobox');
    expect(within(cardSelect).getByRole('option', { name: 'Select category...' })).toBeVisible();
    expect(within(cardSelect).getByRole('option', { name: 'Test A' })).toBeInTheDocument();
    unmount();

    params = new URLSearchParams('tab=all');
    render(<TransactionsPage />);
    await screen.findByText('Test Merchant 1');
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(rowFor('Test Merchant 1'));
    const bulk = screen.getByRole('option', { name: 'Set category...' }).closest('select')!;
    await userEvent.selectOptions(bulk, 'Test A');
    expect(bulk).toHaveValue('c1');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('keeps the drawer open when the transaction leaves the list', async () => {
    params = new URLSearchParams('tab=review');
    render(<TransactionsPage />);
    await userEvent.click((await screen.findAllByText('Test Merchant 1'))[0]);
    const drawer = screen.getByRole('dialog', { name: 'Test Merchant 1' });
    expect(within(drawer).getByText('1 of 2')).toBeInTheDocument();

    queue = { ...emptyQueue, lowConfidence: [t2] };
    txList = [t2];
    const [confirm] = screen.getAllByTitle('Confirm this category');
    await userEvent.click(confirm);
    await waitFor(() => expect(within(drawer).queryByText(/of 2/)).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Test Merchant 1' })).toBeInTheDocument();
  });

  it('closing refreshes the list', async () => {
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');
    const before = transactionGets();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(transactionGets()).toBe(before + 1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pageRoot()).not.toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('clicking the open row again closes the drawer', async () => {
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');
    await userEvent.click(within(rowFor('Test Merchant 1')).getByText('Test Merchant 1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pageRoot()).not.toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('saves a pending edit before switching to another row', async () => {
    render(<TransactionsPage />);
    const drawer = await openRow('Test Merchant 1');
    let titleAtPatch: string | null = null;
    const route = vi.mocked(global.fetch).getMockImplementation()!;
    vi.mocked(global.fetch).mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') {
        titleAtPatch = screen.getByRole('dialog').querySelector('h3')!.textContent;
      }
      return route(url, init);
    });

    await userEvent.type(within(drawer).getByLabelText('Merchant'), 'X');
    await userEvent.click(within(rowFor('Test Merchant 2')).getByText('Test Merchant 2'));
    expect(await screen.findByRole('dialog', { name: 'Test Merchant 2' })).toBeInTheDocument();
    expect(log).toContain('PATCH /api/transactions/t1');
    expect(titleAtPatch).toBe('Test Merchant 1');
    expect(within(screen.getByRole('table')).getByText('Test Merchant 1X')).toBeInTheDocument();
  });

  it('a save queued behind another keeps the earlier edit on the row', async () => {
    render(<TransactionsPage />);
    const drawer = await openRow('Test Merchant 1');
    let release = () => {};
    patchGate = new Promise((r) => (release = r));
    await userEvent.type(within(drawer).getByLabelText('Merchant'), 'X');
    await waitFor(() => expect(log).toContain('PATCH /api/transactions/t1'), { timeout: 2000 });
    await userEvent.type(within(drawer).getByLabelText('Note'), 'N');
    // Let the note's debounce run so its save queues behind the merchant's.
    await new Promise((r) => setTimeout(r, 800));
    release();
    await waitFor(
      () => expect(log.filter((c) => c === 'PATCH /api/transactions/t1')).toHaveLength(2),
      { timeout: 2000 }
    );
    await waitFor(() => expect(within(drawer).getByText('Saved')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).getByText('Test Merchant 1X')).toBeInTheDocument();
  });

  it('stays on the split part until the restored original loads, then shows it', async () => {
    const part: Tx = {
      ...t1,
      parentTransactionId: 'parent',
      parentTransaction: { id: 'parent', amount: -100, merchant: 'Test Merchant 1' },
    };
    const parent: Tx = { ...t1, id: 'parent', merchant: 'Test Original', amount: -100 };
    txList = [part, t2];
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');

    let dialogGone = false;
    let pushLost = false;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[role="dialog"]')) dialogGone = true;
      const root = document.querySelector('h1')?.parentElement?.parentElement;
      if (!root?.classList.contains(DRAWER_PUSH_CLASS)) pushLost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    txList = [parent, t2];
    let release = () => {};
    listGate = new Promise((r) => (release = r));
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit' }));
    await waitFor(() => expect(log).toContain('POST /api/transactions/unsplit'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('dialog', { name: 'Test Merchant 1' })).toBeInTheDocument();

    release();
    expect(await screen.findByRole('dialog', { name: 'Test Original' })).toBeInTheDocument();
    observer.disconnect();
    expect(dialogGone).toBe(false);
    expect(pushLost).toBe(false);
  });

  it('a failed refresh still resolves the pending open', async () => {
    const part: Tx = {
      ...t1,
      parentTransactionId: 'parent',
      parentTransaction: { id: 'parent', amount: -100, merchant: 'Test Merchant 1' },
    };
    const parent: Tx = { ...t1, id: 'parent', merchant: 'Test Original', amount: -100 };
    txList = [part, t2];
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    failQueue = true;
    yearList = [parent, t2];
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit' }));
    expect(await screen.findByRole('dialog', { name: 'Test Original' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('closes when neither the requested nor the current transaction can be found', async () => {
    const part: Tx = {
      ...t1,
      parentTransactionId: 'parent',
      parentTransaction: { id: 'parent', amount: -100, merchant: 'Test Merchant 1' },
    };
    txList = [part, t2];
    render(<TransactionsPage />);
    await openRow('Test Merchant 1');
    txList = [t2];
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pageRoot()).not.toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('stays on the refund when its original is older than the 12-month lookup', async () => {
    const original: Tx = { ...t1, id: 'orig', merchant: 'Test Ancient Original' };
    const refund: Tx = {
      ...t1,
      amount: 42.5,
      isOffset: true,
      linkedTransactionId: 'orig',
      linkedTransaction: original,
    };
    txList = [refund, t2];
    yearList = [refund, t2];
    render(<TransactionsPage />);
    const drawer = await openRow('Test Merchant 1');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Open the original' }));
    await waitFor(() => expect(log).toContain('GET /api/transactions?preset=last-12-months'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('dialog', { name: 'Test Merchant 1' })).toBeInTheDocument();
    expect(pageRoot()).toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('opens an original that is outside the list via the 12-month lookup', async () => {
    const original: Tx = {
      ...t1,
      id: 'orig',
      merchant: 'Test Old Original',
      date: '2025-12-01T00:00:00.000Z',
    };
    const refund: Tx = {
      ...t1,
      amount: 42.5,
      isOffset: true,
      linkedTransactionId: 'orig',
      linkedTransaction: original,
    };
    txList = [refund, t2];
    yearList = [original, refund, t2];
    render(<TransactionsPage />);
    const drawer = await openRow('Test Merchant 1');
    expect(within(drawer).getByText('1 of 2')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Open the original' }));
    const shown = await screen.findByRole('dialog', { name: 'Test Old Original' });
    expect(log).toContain('GET /api/transactions?preset=last-12-months');
    expect(within(shown).queryByText(/of 2/)).toBeNull();
    expect(pageRoot()).toHaveClass(DRAWER_PUSH_CLASS);
  });
});
