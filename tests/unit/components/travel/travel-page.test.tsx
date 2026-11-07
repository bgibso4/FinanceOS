import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => '/travel',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import { triggerSync } from '@/lib/cloud-sync';
import TravelPage from '@/app/(routes)/travel/page';
import type { TripSummary, YearView } from '@/lib/travel/types';

const trip = (id: string, name: string, spend: number, startDate: string): TripSummary => ({
  id,
  name,
  startDate,
  endDate: startDate,
  days: 4,
  spend,
  perDay: spend / 4,
  bookedAhead: 0,
  moneyBack: 0,
  moneyBackCount: 0,
  txCount: 3,
  categories: [{ categoryId: 'c1', name: 'Test Food', spend, share: 1 }],
});

const baseView: YearView = {
  year: 2026,
  trips: [
    trip('t1', 'Test Small', 400, '2026-01-10'),
    trip('t2', 'Test Big', 3000, '2026-06-26'),
    trip('t3', 'Test Mid', 1200, '2026-09-04'),
  ],
  notOnTrip: { spend: 250, count: 2 },
  spent: 4850,
  daysAway: 12,
  perDayAverage: 383,
  previousYearSpent: 4000,
  firstDate: '2025-11-03',
  lastYear: 2026,
};

const emptyView: YearView = {
  ...baseView,
  year: 2027,
  trips: [],
  notOnTrip: { spend: 0, count: 0 },
  spent: 0,
  daysAway: 0,
  previousYearSpent: null,
};

const loose = (id: string, merchant: string) => ({
  id,
  merchant,
  tripId: null,
  date: '2026-03-04T00:00:00.000Z',
  amount: -125,
  confidenceScore: 1,
  isTransfer: false,
  category: { id: 'g1', name: 'Test Flights' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix));

type Reply = { ok?: boolean; body: unknown };
type Mock = {
  view?: YearView;
  budget?: unknown;
  /** Per-URL replies (keyed `METHOD url`); a function may return a promise to hold a response back. */
  replies?: Record<string, Reply | (() => Promise<Reply>)>;
};

function mockApi({ view = baseView, budget = null, replies = {} }: Mock = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const custom = replies[`${method} ${url}`];
      if (custom) {
        const r = typeof custom === 'function' ? await custom() : custom;
        return { ok: r.ok ?? true, status: r.ok === false ? 500 : 200, json: async () => r.body };
      }
      let body: unknown = {};
      if (url.startsWith('/api/travel?')) body = { view, budget };
      else if (url === '/api/categories')
        body = {
          categories: [
            { id: 'g', name: 'Travel', type: 'expense', parentId: null },
            { id: 'g1', name: 'Test Flights', type: 'expense', parentId: 'g' },
          ],
        };
      else if (url === '/api/accounts') body = { accounts: [{ id: 'a1', name: 'Test Card' }] };
      else if (url === '/api/settings') body = { settings: { baseCurrency: 'USD' } };
      else if (url === '/api/tags') body = { tags: [] };
      else if (method === 'GET' && url === '/api/travel/trips') body = { trips: [] };
      else if (url.startsWith('/api/travel/not-on-trip?'))
        body = { transactions: [loose('l1', 'Test Airline')] };
      else if (method === 'POST' && url === '/api/travel/trips')
        body = { id: 'trip9', name: 'Test Lisbon', startDate: '2026-05-10', endDate: '2026-05-17' };
      else if (url === '/api/travel/trips/trip9/suggestions') body = { suggestions: [] };
      return { ok: true, status: 200, json: async () => body };
    })
  );
}

/** A reply held back until `release` is called. */
function held(body: unknown) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { reply: async (): Promise<Reply> => (await gate, { body }), release };
}

beforeEach(() => {
  push.mockReset();
  vi.mocked(triggerSync).mockClear();
  search = 'year=2026';
});

/** The open drawer's title: the first heading in the one dialog there may be. */
const dialogTitle = () =>
  within(screen.getByRole('dialog')).getAllByRole('heading', { level: 3 })[0].textContent;

/** Expands Not on a trip and opens its one row. */
async function openLooseRow() {
  await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
  await userEvent.click(await screen.findByText('Test Airline'));
  await waitFor(() => expect(dialogTitle()).toBe('Test Airline'));
}

describe('TravelPage', () => {
  it('listsTripsBiggestFirst', async () => {
    mockApi();
    render(<TravelPage />);
    await screen.findByText('Test Big');
    const names = screen.getAllByRole('link').map((a) => a.textContent ?? '');
    const order = ['Test Big', 'Test Mid', 'Test Small'].map((n) =>
      names.findIndex((t) => t.includes(n))
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(screen.getByRole('link', { name: /Test Big/ })).toHaveAttribute('href', '/travel/t2');
  });

  it('budgetCardShowsOver', async () => {
    mockApi({ budget: { target: 4000, spent: 4850 } });
    render(<TravelPage />);
    expect(await screen.findByText('$850 over')).toBeInTheDocument();
    expect(screen.getByText(/of \$4,000/)).toBeInTheDocument();
    expect(screen.getByText('Counts trips plus Travel spending not on a trip')).toBeInTheDocument();
  });

  it('budgetCardShowsLeft', async () => {
    mockApi({ budget: { target: 6000, spent: 4850 } });
    render(<TravelPage />);
    expect(await screen.findByText('$1,150 left')).toBeInTheDocument();
  });

  it('setBudgetPutsAmount', async () => {
    mockApi();
    render(<TravelPage />);
    const input = await screen.findByLabelText('Travel budget amount');
    await userEvent.type(input, '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/travel/budget',
        method: 'PUT',
        body: { year: 2026, amount: 5000 },
      })
    );
    await waitFor(() => expect(triggerSync).toHaveBeenCalledTimes(1));
  });

  it('editLinkReopensTheInput', async () => {
    mockApi({ budget: { target: 4000, spent: 4850 } });
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Travel budget amount')).toHaveValue(4000);
  });

  it('showsTripCountAndChangeAgainstLastYear', async () => {
    mockApi();
    render(<TravelPage />);
    expect(await screen.findByText('+21%')).toBeInTheDocument();
    expect(screen.getByText('12 days away')).toBeInTheDocument();
  });

  it('noPreviousYearShowsDash', async () => {
    mockApi({ view: { ...baseView, previousYearSpent: null } });
    render(<TravelPage />);
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.getByText('History starts Nov 2025')).toBeInTheDocument();
  });

  it('notOnTripRowOpensSharedDrawer', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    const row = await screen.findByText('Test Airline');
    expect(callsTo('/api/travel/not-on-trip').map((c) => c.url)).toEqual([
      '/api/travel/not-on-trip?year=2026',
    ]);
    await userEvent.click(row);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText('Test Airline').length).toBeGreaterThan(0);
  });

  it('editingInTheDrawerRefreshesYearAndRows', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    await userEvent.click(await screen.findByText('Test Airline'));
    const drawer = await screen.findByRole('dialog');
    const before = [callsTo('/api/travel?').length, callsTo('/api/travel/not-on-trip').length];
    await userEvent.click(within(drawer).getByRole('button', { name: 'Transfer' }));
    // Every save reloads, and a transfer change also asks for a reload of its own.
    await waitFor(() => {
      expect(callsTo('/api/travel?').length).toBeGreaterThan(before[0]);
      expect(callsTo('/api/travel/not-on-trip').length).toBeGreaterThan(before[1]);
    });
  });

  it('savedEditRefreshesNotOnATripAndTheYearFigures', async () => {
    let saved = false;
    const after: YearView = { ...baseView, notOnTrip: { spend: 200, count: 2 }, spent: 4800 };
    mockApi({
      replies: {
        'PATCH /api/transactions/l1': () => {
          saved = true;
          return Promise.resolve({ body: {} });
        },
        'GET /api/travel?year=2026': () =>
          Promise.resolve({ body: { view: saved ? after : baseView, budget: null } }),
      },
    });
    render(<TravelPage />);
    await openLooseRow();
    const before = callsTo('/api/travel/not-on-trip').length;
    const amount = within(screen.getByRole('dialog')).getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-75');
    expect(await screen.findByText('$4,800', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Not on a trip · \$200/ })).toBeInTheDocument();
    await waitFor(() => expect(callsTo('/api/travel/not-on-trip').length).toBeGreaterThan(before));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('newTripClosesAnOpenTransactionFirst', async () => {
    mockApi();
    render(<TravelPage />);
    await openLooseRow();
    await userEvent.click(screen.getByRole('button', { name: '+ New trip' }));
    await waitFor(() => expect(dialogTitle()).toBe('New trip'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('openingARowClosesTheNewTripDrawer', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    const row = await screen.findByText('Test Airline');
    await userEvent.click(screen.getByRole('button', { name: '+ New trip' }));
    await waitFor(() => expect(dialogTitle()).toBe('New trip'));
    await userEvent.click(row);
    await waitFor(() => expect(dialogTitle()).toBe('Test Airline'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('referenceDataFailureIsShownNotSwallowed', async () => {
    mockApi({ replies: { 'GET /api/categories': { ok: false, body: {} } } });
    render(<TravelPage />);
    expect(await screen.findByText('Could not load categories.')).toBeInTheDocument();
  });

  it('missingCurrencyShowsNoGuessedFigures', async () => {
    mockApi({ replies: { 'GET /api/settings': { ok: false, body: {} } } });
    render(<TravelPage />);
    expect(await screen.findByText('Could not load settings.')).toBeInTheDocument();
    expect(screen.queryByText('Test Big')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('failedYearLoadShowsError', async () => {
    mockApi({
      replies: { 'GET /api/travel?year=2026': { ok: false, body: { error: 'Test boom' } } },
    });
    render(<TravelPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Test boom');
    expect(screen.queryByText('Test Big')).not.toBeInTheDocument();
  });

  it('failedLooseLoadDoesNotHideAsYearReloads', async () => {
    mockApi({
      replies: {
        'GET /api/travel/not-on-trip?year=2026': { ok: false, body: { error: 'Test loose boom' } },
      },
    });
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    expect(await screen.findByText(/Couldn.t load these transactions/)).toBeInTheDocument();
    expect(callsTo('/api/travel/not-on-trip')).toHaveLength(1);
  });

  it('failedLooseLoadCanBeRetriedInPlace', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    mockApi({
      replies: {
        'GET /api/travel/not-on-trip?year=2026': async () =>
          fail
            ? { ok: false, body: { error: 'Test loose boom' } }
            : { body: { transactions: [loose('l1', 'Test Airline')] } },
      },
    });
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    const retry = await screen.findByRole('button', { name: 'Try again' });

    fail = false;
    await userEvent.click(retry);

    expect(await screen.findByText('Test Airline')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load these transactions/)).toBeNull();
    expect(callsTo('/api/travel/not-on-trip')).toHaveLength(2);
    warn.mockRestore();
  });

  it('failedBudgetSaveShowsError', async () => {
    mockApi({
      replies: { 'PUT /api/travel/budget': { ok: false, body: { error: 'Test budget boom' } } },
    });
    render(<TravelPage />);
    await userEvent.type(await screen.findByLabelText('Travel budget amount'), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }));
    expect(await screen.findByText('Test budget boom')).toBeInTheDocument();
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('overBudgetBarIsRed', async () => {
    mockApi({ budget: { target: 4000, spent: 4850 } });
    render(<TravelPage />);
    const bar = await screen.findByTestId('budget-bar');
    expect(bar.style.background).toBe('var(--red)');
    expect(bar.style.width).toBe('100%');
  });

  it('unchangedSpendingIsNeutral', async () => {
    mockApi({ view: { ...baseView, previousYearSpent: 4850 } });
    render(<TravelPage />);
    expect(await screen.findByText('+0%')).toHaveClass('text-[var(--text-muted)]');
  });

  it('steppingToAFutureTripYearIsAllowed', async () => {
    mockApi({ view: { ...baseView, lastYear: 2027 } });
    render(<TravelPage />);
    await screen.findByText('Test Big');
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(push).toHaveBeenCalledWith('/travel?year=2027');
  });

  it('stopsAtLastYear', async () => {
    mockApi();
    render(<TravelPage />);
    await screen.findByText('Test Big');
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });

  it('slowerOlderYearCannotOverwriteTheNewer', async () => {
    const old = held({ view: baseView, budget: null });
    mockApi({
      replies: {
        'GET /api/travel?year=2026': old.reply,
        'GET /api/travel?year=2027': { body: { view: emptyView, budget: null } },
      },
    });
    const { rerender } = render(<TravelPage />);
    await waitFor(() => expect(callsTo('/api/travel?year=2026')).toHaveLength(1));
    search = 'year=2027';
    rerender(<TravelPage />);
    expect(await screen.findByText('No trips in 2027 yet')).toBeInTheDocument();
    old.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Test Big')).not.toBeInTheDocument();
    expect(screen.getByText('No trips in 2027 yet')).toBeInTheDocument();
  });

  it('aSaveFinishingAfterTheYearChangedCannotBringBackTheOldYear', async () => {
    const save = held({});
    mockApi({
      replies: {
        'PATCH /api/transactions/l1': save.reply,
        'GET /api/travel?year=2027': { body: { view: emptyView, budget: null } },
      },
    });
    const { rerender } = render(<TravelPage />);
    await openLooseRow();
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(callsTo('/api/transactions/l1')).toHaveLength(1));

    search = 'year=2027';
    rerender(<TravelPage />);
    expect(await screen.findByText('No trips in 2027 yet')).toBeInTheDocument();
    const gets = callsTo('/api/travel?year=2026').length;

    save.release();
    await new Promise((r) => setTimeout(r, 20));

    expect(callsTo('/api/travel?year=2026')).toHaveLength(gets);
    expect(screen.getByText('No trips in 2027 yet')).toBeInTheDocument();
  });

  it('twoQuickClicksNeverOpenBothDrawers', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    const row = await screen.findByText('Test Airline');

    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: '+ New trip' }));

    await waitFor(() => expect(dialogTitle()).toBe('Test Airline'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('staleNotOnTripRowsCannotLandInANewYear', async () => {
    const old = held({ transactions: [loose('s1', 'Test Stale 2026')] });
    const fresh = held({ transactions: [loose('f1', 'Test Fresh 2027')] });
    const v2027 = { ...baseView, year: 2027, notOnTrip: { spend: 90, count: 1 } };
    mockApi({
      replies: {
        'GET /api/travel?year=2027': { body: { view: v2027, budget: null } },
        'GET /api/travel/not-on-trip?year=2026': old.reply,
        'GET /api/travel/not-on-trip?year=2027': fresh.reply,
      },
    });
    const { rerender } = render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    await waitFor(() => expect(callsTo('/api/travel/not-on-trip')).toHaveLength(1));
    search = 'year=2027';
    rerender(<TravelPage />);
    await screen.findByRole('heading', { name: '2027' });
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    old.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Test Stale 2026')).not.toBeInTheDocument();
    fresh.release();
    expect(await screen.findByText('Test Fresh 2027')).toBeInTheDocument();
    expect(screen.queryByText('Test Stale 2026')).not.toBeInTheDocument();
  });

  it('newTripOpensDrawer', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New trip' }));
    expect(await screen.findByRole('heading', { name: 'New trip' })).toBeInTheDocument();
  });

  it('savingANewTripOpensIt', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New trip' }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Test Lisbon');
    await userEvent.type(screen.getByLabelText('Leave'), '2026-05-10');
    await userEvent.type(screen.getByLabelText('Return'), '2026-05-17');
    await userEvent.click(screen.getByRole('button', { name: 'Next: find transactions' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(push).toHaveBeenCalledWith('/travel/trip9');
  });

  it('leavingANewTripDrawerReloadsTheYear', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New trip' }));
    const before = callsTo('/api/travel?').length;
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(callsTo('/api/travel?')).toHaveLength(before + 1));
  });

  it('emptyYearShowsEmptyState', async () => {
    search = 'year=2027';
    mockApi({ view: emptyView });
    render(<TravelPage />);
    expect(await screen.findByText('No trips in 2027 yet')).toBeInTheDocument();
  });
});
