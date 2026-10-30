import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/plaid/PlaidReconnectButton', () => ({
  PlaidReconnectButton: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText}</button>
  ),
}));

import InvestmentsPage from '@/app/(routes)/investments/page';
import { makeAccount, makeOverview } from '../../../helpers/investment-overview';
import type { InvestmentOverview } from '@/lib/investments/overview';

let overview: InvestmentOverview;
let refreshReply: { status: number; body: unknown };
/** Holds overview responses for one range until `until` resolves. */
let hold: { range: string; until: Promise<void> } | null;

beforeEach(() => {
  overview = makeOverview({ accounts: [makeAccount()] });
  refreshReply = {
    status: 200,
    body: { stopped: false, failedSymbols: [], fetched: 0, valuationRows: 0 },
  };
  hold = null;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/investments/refresh') && init?.method === 'POST') {
      return {
        ok: refreshReply.status < 400,
        status: refreshReply.status,
        json: async () => refreshReply.body,
      } as Response;
    }
    if (u.startsWith('/api/investments/overview')) {
      const range = new URLSearchParams(u.split('?')[1]).get('range');
      if (hold && hold.range === range) await hold.until;
      return { ok: true, status: 200, json: async () => ({ ...overview, range }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: 'Not mocked' }) } as Response;
  }) as unknown as typeof fetch;
});

const urls = () =>
  vi.mocked(global.fetch).mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);

/** Counts cloud-sync requests (`triggerSync()` dispatches this window event). */
function listenForSync() {
  const synced = vi.fn();
  window.addEventListener('financeos-sync-trigger', synced);
  return { synced, stop: () => window.removeEventListener('financeos-sync-trigger', synced) };
}

describe('InvestmentsPage', () => {
  it('loads the overview, refreshes prices once, then reloads', async () => {
    const { synced, stop } = listenForSync();
    render(<InvestmentsPage />);
    expect(await screen.findByRole('heading', { name: 'Investments' })).toBeInTheDocument();
    await waitFor(() =>
      expect(urls()).toEqual([
        'GET /api/investments/overview?range=3M',
        'POST /api/investments/refresh',
        'GET /api/investments/overview?range=3M',
      ])
    );
    expect(await screen.findByText('Prices as of Oct 9 close')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All accounts' })).toBeInTheDocument();
    expect(synced).not.toHaveBeenCalled(); // the refresh stored nothing
    stop();
  });

  it('offers 3Y and All and loads the range picked', async () => {
    render(<InvestmentsPage />);
    await screen.findByRole('heading', { name: 'All accounts' });
    expect(screen.getByRole('button', { name: '3Y' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(urls()).toContain('GET /api/investments/overview?range=All'));
  });

  it('syncs after a refresh that stored prices', async () => {
    const { synced, stop } = listenForSync();
    refreshReply = {
      status: 200,
      body: { stopped: false, failedSymbols: [], fetched: 1, valuationRows: 2 },
    };
    render(<InvestmentsPage />);
    await waitFor(() => expect(synced).toHaveBeenCalledTimes(1));
    stop();
  });

  it('ignores an overview response that arrives after a newer one', async () => {
    let release = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    hold = { range: '3M', until };
    render(<InvestmentsPage />);
    await userEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText('balance change · 1M')).toBeInTheDocument();
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('balance change · 1M')).toBeInTheDocument();
    expect(screen.queryByText('balance change · 3M')).toBeNull();
  });

  it('keeps the page usable when the refresh fails', async () => {
    refreshReply = { status: 502, body: { error: 'Price service unavailable' } };
    overview = makeOverview({
      accounts: [makeAccount()],
      prices: { asOf: '2026-10-06', stale: true },
    });
    render(<InvestmentsPage />);
    expect(
      await screen.findByText('Prices as of Oct 6 close · couldn’t reach price source')
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Investment accounts' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(urls().filter((u) => u === 'POST /api/investments/refresh')).toHaveLength(2)
    );
  });

  it('offers Retry after a failed refresh even while prices are not yet stale', async () => {
    refreshReply = { status: 502, body: { error: 'Price service unavailable' } };
    render(<InvestmentsPage />);
    expect(
      await screen.findByText('Prices as of Oct 9 close · couldn’t reach price source')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('reports a failed refresh with no prices at all', async () => {
    refreshReply = { status: 200, body: { stopped: true, failedSymbols: [], fetched: 0 } };
    overview = makeOverview({ accounts: [makeAccount()], prices: { asOf: null, stale: false } });
    render(<InvestmentsPage />);
    expect(
      await screen.findByText('Prices unavailable · couldn’t reach price source')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('switches range and selection', async () => {
    render(<InvestmentsPage />);
    await screen.findByRole('heading', { name: 'All accounts' });
    await userEvent.click(screen.getByRole('button', { name: '1M' }));
    await waitFor(() => expect(urls()).toContain('GET /api/investments/overview?range=1M'));
    await userEvent.click(screen.getByText('Brokerage'));
    expect(await screen.findByRole('heading', { name: 'Brokerage' })).toBeInTheDocument();
  });

  it('renders the empty state when there are no investment accounts', async () => {
    overview = makeOverview({ accounts: [], holdings: [] });
    render(<InvestmentsPage />);
    expect(await screen.findByText('No investment accounts yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings → Accounts' })).toHaveAttribute(
      'href',
      '/settings?tab=accounts'
    );
  });

  it('links an unpriced holding’s notice to Settings → Securities, with no price window', async () => {
    overview = makeOverview({
      accounts: [
        makeAccount({
          status: {
            needsReauth: null,
            waiting: null,
            unpriced: [{ securityId: 'sec-z', label: 'ZZZ' }],
            tradesReported: true,
          },
        }),
      ],
    });
    render(<InvestmentsPage />);
    await userEvent.click(await screen.findByText('Brokerage'));
    expect(await screen.findByRole('link', { name: 'Set up pricing' })).toHaveAttribute(
      'href',
      '/settings?tab=securities&security=sec-z'
    );
    expect(screen.getByText('ZZZ has no price source.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set symbol' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /is priced$/ })).toBeNull();
  });
});
