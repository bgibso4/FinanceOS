import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => '/travel/t1',
  useParams: () => ({ id: 't1' }),
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import TripPage from '@/app/(routes)/travel/[id]/page';
import type { TripSummary } from '@/lib/travel/types';

const trip: TripSummary = {
  id: 't1',
  name: 'Test Whistler',
  startDate: '2026-01-13',
  endDate: '2026-01-21',
  days: 9,
  spend: 2600,
  perDay: 289,
  bookedAhead: 40,
  moneyBack: 174,
  moneyBackCount: 3,
  txCount: 42,
  categories: [
    { categoryId: 'c1', name: 'Test Lodging', spend: 1280, share: 0.5 },
    { categoryId: 'c2', name: 'Test Food', spend: 640, share: 0.25 },
  ],
};

const tx = (id: string, merchant: string, date: string) => ({
  id,
  merchant,
  tripId: 't1',
  date: `${date}T00:00:00.000Z`,
  amount: -50,
  confidenceScore: 1,
  isTransfer: false,
  category: { id: 'g1', name: 'Test Flights' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
});

const transactions = [
  tx('x3', 'Test After Shop', '2026-01-25'),
  tx('x2', 'Test During Cafe', '2026-01-18'),
  tx('x1', 'Test Before Airline', '2026-01-10'),
];

type Call = { url: string; method: string };
let calls: Call[];

function mockApi({
  suggestionCount = 3,
  tripReply,
  yearOk = true,
}: {
  suggestionCount?: number;
  tripReply?: { ok: boolean; status: number; body: unknown };
  yearOk?: boolean;
} = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const reply = (body: unknown, ok = true, status = 200) => ({
        ok,
        status,
        json: async () => body,
      });
      if (url === '/api/travel/trips/t1' && method === 'GET')
        return tripReply
          ? reply(tripReply.body, tripReply.ok, tripReply.status)
          : reply({ trip, transactions, suggestionCount });
      if (url === '/api/travel/trips/t1' && method === 'DELETE') return reply({ success: true });
      if (url === '/api/travel/trips/t1/suggestions') return reply({ suggestions: [] });
      if (url === '/api/travel?year=2026')
        return yearOk
          ? reply({ view: { perDayAverage: 298 }, budget: null })
          : reply({ error: 'Test year boom' }, false, 500);
      if (url === '/api/categories')
        return reply({
          categories: [
            { id: 'g', name: 'Travel', type: 'expense', parentId: null },
            { id: 'g1', name: 'Test Flights', type: 'expense', parentId: 'g' },
          ],
        });
      if (url === '/api/accounts') return reply({ accounts: [{ id: 'a1', name: 'Test Card' }] });
      if (url === '/api/settings') return reply({ settings: { baseCurrency: 'USD' } });
      if (url === '/api/tags') return reply({ tags: [] });
      if (url === '/api/travel/trips') return reply({ trips: [] });
      return reply({});
    })
  );
}

beforeEach(() => push.mockReset());

describe('TripPage', () => {
  it('showsStatsAndCategories', async () => {
    mockApi();
    render(<TripPage />);
    expect(await screen.findByRole('heading', { name: 'Test Whistler' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Travel · 2026' })).toHaveAttribute(
      'href',
      '/travel?year=2026'
    );
    expect(screen.getByText('Jan 13 – Jan 21, 2026 · 9 days')).toBeInTheDocument();
    expect(screen.getByText('$2,600')).toBeInTheDocument();
    expect(screen.getByText('42 transactions')).toBeInTheDocument();
    expect(screen.getByText('$289')).toBeInTheDocument();
    expect(await screen.findByText('2026 trips average $298')).toBeInTheDocument();
    expect(screen.getByText('$40')).toBeInTheDocument();
    expect(screen.getByText('before Jan 13')).toBeInTheDocument();
    expect(screen.getByText('+$174')).toHaveClass('text-[var(--green)]');
    expect(screen.getByText('3 paybacks · already taken off the total')).toBeInTheDocument();
    expect(screen.getByText('Test Lodging')).toBeInTheDocument();
    expect(screen.getByText('$1,280')).toBeInTheDocument();
    expect(screen.getByText('$640')).toBeInTheDocument();
  });

  it('omitsTheComparisonWhenTheYearRequestFails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockApi({ yearOk: false });
    render(<TripPage />);
    expect(await screen.findByText('$289')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/travel?year=2026')).toBe(true));
    expect(screen.queryByText(/trips average/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('missingTripSaysSoWithALinkBack', async () => {
    mockApi({ tripReply: { ok: false, status: 404, body: { error: 'Trip not found' } } });
    render(<TripPage />);
    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to travel' })).toHaveAttribute('href', '/travel');
  });

  it('groupsBeforeDuringAfter', async () => {
    mockApi();
    render(<TripPage />);
    await screen.findByText('Test During Cafe');
    const cells = screen.getAllByRole('cell').map((c) => c.textContent ?? '');
    const at = (text: string) => cells.findIndex((t) => t.includes(text));
    expect(at('Before')).toBeLessThan(at('Test Before Airline'));
    expect(at('Test Before Airline')).toBeLessThan(at('During'));
    expect(at('During')).toBeLessThan(at('Test During Cafe'));
    expect(at('Test During Cafe')).toBeLessThan(at('After'));
    expect(at('After')).toBeLessThan(at('Test After Shop'));
  });

  it('rowOpensSharedDrawerAndArrowsStepTripRows', async () => {
    mockApi();
    render(<TripPage />);
    await userEvent.click(await screen.findByText('Test Before Airline'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByText('Test Before Airline').length).toBeGreaterThan(0);
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getAllByText('Test During Cafe').length
      ).toBeGreaterThan(0)
    );
  });

  it('reviewButtonHiddenAtZero', async () => {
    mockApi({ suggestionCount: 0 });
    render(<TripPage />);
    await screen.findByRole('heading', { name: 'Test Whistler' });
    expect(screen.queryByRole('button', { name: /Review suggestions/ })).not.toBeInTheDocument();
  });

  it('reviewButtonOpensReview', async () => {
    mockApi();
    render(<TripPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review suggestions · 3' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/travel/trips/t1/suggestions')).toBe(true)
    );
  });

  it('closingTheTripDrawerReloadsTheTrip', async () => {
    mockApi();
    render(<TripPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit trip' }));
    const before = calls.filter(
      (c) => c.url === '/api/travel/trips/t1' && c.method === 'GET'
    ).length;
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url === '/api/travel/trips/t1' && c.method === 'GET')
      ).toHaveLength(before + 1)
    );
  });

  it('deleteReturnsToYear', async () => {
    mockApi();
    render(<TripPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit trip' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/travel?year=2026'));
  });

  it('noFiguresUntilCurrencyIsKnown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockApi();
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: url !== '/api/settings',
          status: url === '/api/settings' ? 500 : 200,
          json: async () =>
            url === '/api/travel/trips/t1' ? { trip, transactions, suggestionCount: 0 } : {},
        }) as Response
    );
    render(<TripPage />);
    expect(await screen.findByText('Could not load settings.')).toBeInTheDocument();
    expect(screen.queryByText('$2,600')).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
