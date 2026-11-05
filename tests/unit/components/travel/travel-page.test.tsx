import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => '/travel',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

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
  firstYear: 2025,
};

const categories = [
  { id: 'g', name: 'Travel', type: 'expense', parentId: null },
  { id: 'g1', name: 'Test Flights', type: 'expense', parentId: 'g' },
  { id: 'x', name: 'Test Dining', type: 'expense', parentId: null },
];
const loose = (id: string, tripId: string | null, merchant: string) => ({
  id,
  merchant,
  tripId,
  date: '2026-03-04T00:00:00.000Z',
  amount: -125,
  confidenceScore: 1,
  isTransfer: false,
  category: { id: 'g1', name: 'Test Flights' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
});

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function mockApi(view: YearView = baseView, budget: unknown = null) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let body: unknown = {};
      if (url.startsWith('/api/travel?')) body = { view, budget };
      else if (url === '/api/categories') body = { categories };
      else if (url === '/api/accounts') body = { accounts: [{ id: 'a1', name: 'Test Card' }] };
      else if (url === '/api/settings') body = { settings: { baseCurrency: 'USD' } };
      else if (url === '/api/tags') body = { tags: [] };
      else if (url === '/api/travel/trips') body = { trips: [] };
      else if (url.startsWith('/api/transactions?'))
        body = {
          transactions: [loose('l1', null, 'Test Airline'), loose('l2', 't2', 'Test On Trip')],
        };
      return { ok: true, status: 200, json: async () => body };
    })
  );
}

beforeEach(() => {
  push.mockReset();
  search = 'year=2026';
});

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
    mockApi(baseView, { target: 4000, spent: 4850 });
    render(<TravelPage />);
    expect(await screen.findByText('$850 over')).toBeInTheDocument();
    expect(screen.getByText(/of \$4,000/)).toBeInTheDocument();
    expect(screen.getByText('Counts trips plus Travel spending not on a trip')).toBeInTheDocument();
  });

  it('budgetCardShowsLeft', async () => {
    mockApi(baseView, { target: 6000, spent: 4850 });
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
  });

  it('editLinkReopensTheInput', async () => {
    mockApi(baseView, { target: 4000, spent: 4850 });
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
    mockApi({ ...baseView, previousYearSpent: null, firstYear: 2026 });
    render(<TravelPage />);
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.getByText(/History starts 2026/)).toBeInTheDocument();
  });

  it('notOnTripRowOpensSharedDrawer', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Not on a trip/ }));
    const row = await screen.findByText('Test Airline');
    // Only Travel-group rows that sit on no trip are listed.
    expect(screen.queryByText('Test On Trip')).not.toBeInTheDocument();
    const url = calls.find((c) => c.url.startsWith('/api/transactions?'))!.url;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.getAll('category').sort()).toEqual(['g', 'g1']);
    expect(params.get('startDate')).toBe('2026-01-01');
    expect(params.get('endDate')).toBe('2026-12-31');
    await userEvent.click(row);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText('Test Airline').length).toBeGreaterThan(0);
  });

  it('newTripOpensDrawer', async () => {
    mockApi();
    render(<TravelPage />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New trip' }));
    expect(await screen.findByRole('heading', { name: 'New trip' })).toBeInTheDocument();
  });

  it('emptyYearShowsEmptyState', async () => {
    search = 'year=2027';
    mockApi({
      ...baseView,
      year: 2027,
      trips: [],
      notOnTrip: { spend: 0, count: 0 },
      spent: 0,
      daysAway: 0,
      previousYearSpent: null,
    });
    render(<TravelPage />);
    expect(await screen.findByText('No trips in 2027 yet')).toBeInTheDocument();
  });
});
