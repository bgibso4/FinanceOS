import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { freezeClock, inNewYork } from '../../helpers/time-zone';
import { resetNavigation, router, setSearch } from '../../helpers/navigation';

vi.mock('next/navigation', () => import('../../helpers/navigation'));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import AnalyticsPage from '@/app/(routes)/analytics/page';

const CATEGORIES = [
  { id: 'g1', name: 'Test Group', type: 'expense', parentId: null },
  { id: 'c1', name: 'Test A', type: 'expense', parentId: 'g1' },
  { id: 'c2', name: 'Test B', type: 'expense', parentId: 'g1' },
];

const tx = {
  id: 't1',
  date: '2026-11-03T00:00:00.000Z',
  merchant: 'Merchant One',
  amount: -40,
  category: { id: 'c1', name: 'Test A' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
};

let log: string[];
/** Answers held back until released, keyed "<endpoint>|<month the period starts in>". */
let gates: Map<string, Promise<void>>;
/** Spend the dashboard and daily data report, keyed by the period's first month. */
let spent: Record<string, number>;
/** The comparison spend the dashboard reports overall (netCashflow.prevSpending). */
let prevSpending: number;

/** Holds `endpoint`'s answer for `month` until the returned release is called. */
function hold(endpoint: string, month: string): () => void {
  let release = () => {};
  gates.set(
    `${endpoint}|${month}`,
    new Promise((resolve) => {
      release = resolve;
    })
  );
  return release;
}

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const requests = (path: string) =>
  log.filter((u) => u.startsWith(path)).map((u) => new URL(u, 'http://test').searchParams);

beforeEach(() => {
  resetNavigation();
  log = [];
  gates = new Map();
  spent = {};
  prevSpending = 20;
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    log.push(u);
    if (u === '/api/categories') return respond({ categories: CATEGORIES });
    if (u === '/api/settings') return respond({ settings: { baseCurrency: 'USD' } });
    if (u === '/api/accounts') return respond({ accounts: [{ id: 'a1', name: 'Test Card' }] });
    if (u === '/api/tags') return respond({ tags: [{ id: 'v', name: 'Vacation', color: 'blue' }] });
    if (u.startsWith('/api/budgets/')) return respond({ budgets: [] });
    if (u.startsWith('/api/analytics/')) {
      const endpoint = u.slice('/api/analytics/'.length).split('?')[0];
      const start = new URL(u, 'http://test').searchParams.get('startDate')!;
      const month = start.slice(0, 7);
      const gate = gates.get(`${endpoint}|${month}`);
      if (gate) await gate;
      const amount = spent[month] ?? 40;
      if (endpoint === 'daily') {
        return respond({ current: [{ date: start, categoryId: 'c1', amount }], compare: [] });
      }
      return respond({
        netCashflow: { spending: amount, prevSpending },
        spendByCategory: [{ category: 'Test A', amount, txCount: 1, prevAmount: 20 }],
      });
    }
    if (u.startsWith('/api/transactions?')) return respond({ transactions: [tx] });
    if (/^\/api\/transactions\/[^/]+\/returns$/.test(u)) return respond({ matches: [] });
    return respond({});
  }) as unknown as typeof fetch;
});

const figures = () => screen.findByRole('region', { name: 'Figures' });
const panel = () => screen.queryByRole('dialog', { name: 'Filters' });

function visit(search = '') {
  resetNavigation(search);
  render(<AnalyticsPage />);
}

describe('Analytics page', () => {
  inNewYork();
  beforeEach(() => freezeClock('2026-11-07T17:00:00.000Z'));

  it('freshVisitIsThisMonthVsPeriodBefore', async () => {
    visit();

    await waitFor(() => expect(requests('/api/analytics/dashboard')).toHaveLength(1));
    const q = requests('/api/analytics/dashboard')[0];
    expect(q.get('startDate')).toBe('2026-11-01');
    expect(q.get('endDate')).toBe('2026-11-07');
    expect(q.get('compareStart')).toBe('2026-10-01');
    expect(q.get('compareEnd')).toBe('2026-10-07');
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getByText('November 2026')).toBeInTheDocument();
    expect(within(chips).getByText('Period before')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
  });

  it('arrowsStepAndReplaceAddress', async () => {
    visit();

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));

    expect(router.replace).toHaveBeenCalledWith('/analytics?at=2026-10', { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        requests('/api/analytics/dashboard').some(
          (q) =>
            q.get('startDate') === '2026-10-01' &&
            q.get('endDate') === '2026-10-31' &&
            q.get('compareStart') === '2026-09-01' &&
            q.get('compareEnd') === '2026-09-30'
        )
      ).toBe(true)
    );
    expect(await screen.findByText('October 2026', { selector: 'button' })).toBeInTheDocument();
  });

  it('nextDisabledOnCurrentPeriod', async () => {
    visit();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));

    expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();
  });

  it('openingTransactionClosesFilterPanel', async () => {
    visit();
    await userEvent.click(await screen.findByText('Test A', { selector: 'span.font-semibold' }));
    const row = await within(await screen.findByRole('table')).findByText('Merchant One');

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(panel()).toBeInTheDocument();

    // A plain click, with no pointerdown: the panel must close because a transaction opened.
    fireEvent.click(row);

    expect(await screen.findByRole('dialog', { name: 'Merchant One' })).toBeInTheDocument();
    expect(panel()).not.toBeInTheDocument();
  });

  it('rowsFetchCarriesFilters', async () => {
    visit('account=a1&tag=Vacation');

    await userEvent.click(await screen.findByText('Test A', { selector: 'span.font-semibold' }));

    await waitFor(() => expect(requests('/api/transactions?')).toHaveLength(1));
    const q = requests('/api/transactions?')[0];
    expect(q.get('category')).toBe('c1');
    expect(q.getAll('account')).toEqual(['a1']);
    expect(q.getAll('tag')).toEqual(['Vacation']);
    expect(q.get('startDate')).toBe('2026-11-01');
    expect(q.get('endDate')).toBe('2026-11-07');
  });

  it('budgetsOnlyForPlainMonth', async () => {
    visit();
    await waitFor(() => expect(log).toContain('/api/budgets/2026-11'));

    for (const search of ['account=a1', 'merchant=shell', 'period=3m', 'period=year']) {
      log = [];
      act(() => setSearch(search));
      await waitFor(() => expect(requests('/api/analytics/dashboard').length).toBeGreaterThan(0));
      expect(log.some((u) => u.startsWith('/api/budgets/'))).toBe(false);
    }
  });

  it('perDayWhenDaily', async () => {
    visit();
    expect(await within(await figures()).findByText('Per day')).toBeInTheDocument();
    expect(within(await figures()).queryByText('Per month')).not.toBeInTheDocument();
  });

  it('perMonthOverMonths', async () => {
    visit('period=3m');
    expect(await within(await figures()).findByText('Per month')).toBeInTheDocument();
    expect(within(await figures()).queryByText('Per day')).not.toBeInTheDocument();
  });

  it('staleResponseIsIgnored', async () => {
    const release = hold('dashboard', '2026-11');
    spent = { '2026-11': 111, '2026-10': 222 };
    visit();

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(await within(await figures()).findByText('$222')).toBeInTheDocument();

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(within(await figures()).getByText('$222')).toBeInTheDocument();
    expect(within(await figures()).queryByText('$111')).not.toBeInTheDocument();
  });

  it('staleDailyResponseIsIgnored', async () => {
    const release = hold('daily', '2026-11');
    spent = { '2026-11': 111, '2026-10': 222 };
    visit();

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(await screen.findByText(/^\$222 in Oct 2026/)).toBeInTheDocument();

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText(/^\$222 in Oct 2026/)).toBeInTheDocument();
  });

  it('comparisonFigureIsTheWholeComparisonSpend', async () => {
    // Spend in categories with none this period still counts towards the comparison.
    prevSpending = 75;
    spent = { '2026-11': 40 };
    visit();

    const figure = within(await figures());
    expect(await figure.findByText('$75')).toBeInTheDocument();
    expect(figure.getByText('$40')).toBeInTheDocument();
    expect(figure.queryByText('$20')).not.toBeInTheDocument();
  });

  it('sixPicksEachKeepARingSlice', async () => {
    // M7: six picks draw six lines, so all six are listed under Where it went.
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `p${n}`,
      name: `Pick ${n}`,
      type: 'expense',
      parentId: null,
    }));
    const answer = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === '/api/categories') return respond({ categories: six });
      if (u.startsWith('/api/analytics/daily')) {
        const rows = six.map((c, i) => ({ date: '2026-11-02', categoryId: c.id, amount: 60 - i }));
        return respond({ current: rows, compare: [] });
      }
      return answer(url);
    }) as unknown as typeof fetch;
    visit(six.map((c) => `category=${c.id}`).join('&'));

    const list = await screen.findByRole('list', { name: 'Top categories' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(6));
    expect(within(list).getByText('Pick 6')).toBeInTheDocument();
    expect(within(list).queryByText('Everything else')).not.toBeInTheDocument();
  });

  it('noFutureWarning', async () => {
    visit('at=2027-01');

    expect(await screen.findByText('November 2026', { selector: 'button' })).toBeInTheDocument();
    expect(screen.queryByText(/future/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Monthly Analytics')).not.toBeInTheDocument();
  });
});
