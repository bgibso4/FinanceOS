import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefundsSection } from '@/components/transactions/refunds-section';
import type { Tx } from '@/components/transactions/types';
import { triggerSync } from '@/lib/cloud-sync';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

const base: Tx = {
  id: 'r1',
  date: '2026-01-04T00:00:00.000Z',
  merchant: 'Test Refund',
  amount: 20,
  confidenceScore: 1,
  isTransfer: false,
};

const purchase: Tx = { ...base, id: 'p1', merchant: 'Test Store', amount: -50 };

const match = {
  id: 'p1',
  merchant: 'Test Store',
  amount: -50,
  date: '2026-01-01T00:00:00.000Z',
  daysDiff: 3,
  score: 0.9,
  amountDiff: 30,
};

const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });

function setup(tx: Tx, props: { startOpen?: boolean } = {}) {
  const onChanged = vi.fn();
  const onOpen = vi.fn();
  render(
    <RefundsSection baseCurrency="USD" tx={tx} onChanged={onChanged} onOpen={onOpen} {...props} />
  );
  return { onChanged, onOpen };
}

describe('RefundsSection', () => {
  beforeEach(() => {
    vi.mocked(triggerSync).mockClear();
    global.fetch = vi.fn().mockResolvedValue(reply({ matches: [match] })) as typeof fetch;
  });

  it('is hidden for transfers', () => {
    const { container } = render(
      <RefundsSection
        baseCurrency="USD"
        tx={{ ...base, isTransfer: true }}
        onChanged={vi.fn()}
        onOpen={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('credit: opening lists suggested matches and links with the current payload', async () => {
    const { onChanged } = setup(base);
    await userEvent.click(screen.getByRole('button', { name: '+ Link to a purchase' }));
    expect(await screen.findByText('Test Store')).toBeInTheDocument();
    expect(screen.getByText('90% match')).toBeInTheDocument();
    expect(screen.getByText('$30.00 diff')).toBeInTheDocument();
    expect(screen.getByText(/3 days before/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/transactions/r1/returns',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ originalTransactionId: 'p1' }),
      })
    );
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('shows the error and does not collapse when linking fails', async () => {
    const { onChanged } = setup(base, { startOpen: true });
    await screen.findByText('Test Store');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      reply({ error: 'Already linked' }, false)
    );
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText('Already linked')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('startOpen fetches matches without a click', async () => {
    setup(base, { startOpen: true });
    expect(await screen.findByText('Test Store')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/transactions/r1/returns', expect.anything());
  });

  it('says so when there are no matches', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ matches: [] })) as typeof fetch;
    setup(base, { startOpen: true });
    expect(await screen.findByText('No likely matches found.')).toBeInTheDocument();
  });

  it('searches by merchant, excluding itself and already linked rows', async () => {
    setup({ ...base, amount: -20 }, { startOpen: true });
    await screen.findByText('Test Store');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      reply({
        transactions: [
          { ...purchase, id: 'r1' },
          { ...purchase, id: 'x1', isOffset: true },
          { ...purchase, id: 'x2', linkedTransactionId: 'z' },
          { ...purchase, id: 'p9', merchant: 'Test Found', amount: -45 },
        ],
      })
    );
    await userEvent.type(screen.getByPlaceholderText('Search by merchant…'), 'test f');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Test Found')).toBeInTheDocument();
    expect(screen.getByText('50% match')).toBeInTheDocument();
    expect(screen.getByText('$25.00 diff')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Link' })).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/transactions?merchant=test%20f&preset=last-12-months',
      expect.anything()
    );
  });

  it('cancel collapses the open section', async () => {
    setup(base, { startOpen: true });
    await screen.findByText('Test Store');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: '+ Link to a purchase' })).toBeInTheDocument();
  });

  it('offset shows original, opens it, and unlinks', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ success: true })) as typeof fetch;
    const { onOpen, onChanged } = setup({
      ...base,
      isOffset: true,
      linkedTransactionId: 'p1',
      linkedTransaction: purchase,
    });
    expect(screen.getByText('Test Store')).toBeInTheDocument();
    expect(screen.getByText('↑ paid back by this')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open the original' }));
    expect(onOpen).toHaveBeenCalledWith('p1');
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/transactions/r1/returns',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('original shows each offset and the net', async () => {
    global.fetch = vi.fn().mockResolvedValue(reply({ success: true })) as typeof fetch;
    setup({
      ...purchase,
      offsetTransactions: [
        { ...base, id: 'r1', amount: 20 },
        { ...base, id: 'r2', amount: 10 },
      ],
    });
    expect(screen.getByText(/Net/)).toHaveTextContent('20.00');
    const unlinks = screen.getAllByRole('button', { name: 'Unlink' });
    expect(unlinks).toHaveLength(2);
    await userEvent.click(unlinks[1]);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/transactions/r2/returns',
        expect.objectContaining({ method: 'DELETE' })
      )
    );
  });
});
