import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetNavigation } from '../../helpers/navigation';

vi.mock('next/navigation', () => import('../../helpers/navigation'));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import AnalyticsPage from '@/app/(routes)/analytics/page';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import type { Tx } from '@/components/transactions/types';

const CATEGORIES = [
  { id: 'g1', name: 'Test Group', type: 'expense', parentId: null },
  { id: 'c1', name: 'Test A', type: 'expense', parentId: 'g1' },
  { id: 'c2', name: 'Test B', type: 'expense', parentId: 'g1' },
];

const base: Tx = {
  id: 't1',
  date: new Date().toISOString(),
  merchant: 'Merchant One',
  amount: -40,
  category: { id: 'c1', name: 'Test A' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
};

let store: Tx[];
let log: string[];
// Holds GETs of a month's rows in flight until released.
let gates: Map<string, Promise<void>>;

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

const spendByCategory = () =>
  CATEGORIES.map((c) => {
    const rows = store.filter((t) => t.category?.id === c.id && !t.isTransfer);
    return {
      category: c.name,
      amount: rows.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      txCount: rows.length,
      prevAmount: 0,
    };
  }).filter((c) => c.txCount > 0);

beforeEach(() => {
  resetNavigation();
  store = [
    base,
    { ...base, id: 't2', merchant: 'Merchant Two', amount: -10 },
    { ...base, id: 't3', merchant: 'Merchant Three', category: { id: 'c2', name: 'Test B' } },
  ];
  log = [];
  gates = new Map();
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    log.push(`${method} ${u}`);
    if (method === 'PATCH') {
      const id = u.split('/').pop();
      const body = JSON.parse(String(init?.body)) as { categoryId?: string; isTransfer?: boolean };
      store = store.map((t) => {
        if (t.id !== id) return t;
        const category = CATEGORIES.find((c) => c.id === body.categoryId);
        return {
          ...t,
          ...(body.isTransfer !== undefined && { isTransfer: body.isTransfer }),
          ...(category && { category: { id: category.id, name: category.name } }),
        };
      });
      return respond({});
    }
    if (u === '/api/categories') return respond({ categories: CATEGORIES });
    if (u === '/api/settings') return respond({ settings: { baseCurrency: 'USD' } });
    if (u === '/api/accounts') return respond({ accounts: [{ id: 'a1', name: 'Test Card' }] });
    if (u === '/api/tags') return respond({ tags: [] });
    if (u === '/api/travel/trips') return respond({ trips: [] });
    if (u.startsWith('/api/budgets/')) return respond({ budgets: [] });
    if (u.startsWith('/api/analytics/daily')) return respond({ current: [], compare: null });
    if (u.startsWith('/api/analytics/dashboard')) {
      return respond({ spendByCategory: spendByCategory() });
    }
    if (u.startsWith('/api/transactions?')) {
      const q = new URL(u, 'http://test').searchParams;
      const gate = gates.get(q.get('startDate')!.slice(0, 7));
      if (gate) await gate;
      const category = q.get('category');
      return respond({
        transactions: store.filter((t) => !category || t.category?.id === category),
      });
    }
    if (/^\/api\/transactions\/[^/]+\/returns$/.test(u)) return respond({ matches: [] });
    return respond({});
  }) as unknown as typeof fetch;
});

const heading = () => screen.getByRole('heading', { level: 1, name: 'Analytics' });
const pageRoot = () => heading().parentElement!.parentElement!.parentElement!;
const rowsTable = () => screen.getByRole('table');

// The name also shows under Where it went and in the drawer's select; only the breakdown is bold.
const categoryRow = (category: string) =>
  screen.findByText(category, { selector: 'span.font-semibold' });

async function expand(category: string) {
  await userEvent.click(await categoryRow(category));
  await within(await screen.findByRole('table')).findAllByRole('row');
}

async function openRow(merchant: string) {
  await userEvent.click(await within(rowsTable()).findByText(merchant));
  return screen.findByRole('dialog', { name: merchant });
}

const monthKey = (offset: number) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('Analytics page → shared drawer', () => {
  it('leaves outside-budget rows out of the list unless the toggle is on', async () => {
    store.push({ ...base, id: 't4', merchant: 'Outside Merchant', isOutsideBudget: true });
    const { unmount } = render(<AnalyticsPage />);
    await expand('Test A');

    expect(within(rowsTable()).getByText('Merchant One')).toBeInTheDocument();
    expect(within(rowsTable()).queryByText('Outside Merchant')).not.toBeInTheDocument();
    unmount();

    resetNavigation('outside=1');
    render(<AnalyticsPage />);
    await expand('Test A');

    expect(within(rowsTable()).getByText('Outside Merchant')).toBeInTheDocument();
  });

  it('opens the shared drawer from a row and pushes the page', async () => {
    render(<AnalyticsPage />);
    await expand('Test A');

    const dialog = await openRow('Merchant One');

    expect(within(dialog).getByLabelText('Category')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument();
    expect(pageRoot()).toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('shows a row in its own currency', async () => {
    store[0] = { ...base, account: { id: 'a2', name: 'CAD Account', currency: 'CAD' } };
    render(<AnalyticsPage />);
    await expand('Test A');

    expect(within(rowsTable()).getByText(/40\.00 CAD/)).toBeInTheDocument();
  });

  it('keeps a recategorized row in place until the drawer closes, updating figures at once', async () => {
    render(<AnalyticsPage />);
    await expand('Test A');
    const dialog = await openRow('Merchant One');
    const figuresBefore = log.filter((c) => c.includes('/api/analytics/dashboard')).length;

    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'c2');

    await waitFor(() =>
      expect(log.filter((c) => c.includes('/api/analytics/dashboard')).length).toBeGreaterThan(
        figuresBefore
      )
    );
    expect(within(rowsTable()).getByText('Merchant One')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(within(rowsTable()).queryByText('Merchant One')).not.toBeInTheDocument()
    );
    expect(pageRoot()).not.toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('keeps a row marked as a transfer until the drawer closes', async () => {
    render(<AnalyticsPage />);
    await expand('Test A');
    const dialog = await openRow('Merchant One');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

    await waitFor(() => expect(within(rowsTable()).getByText('Transfer')).toBeInTheDocument());
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(within(rowsTable()).queryByText('Merchant One')).not.toBeInTheDocument()
    );
  });

  it('closes the drawer when another category opens', async () => {
    render(<AnalyticsPage />);
    await expand('Test A');
    await openRow('Merchant One');

    await userEvent.click(await categoryRow('Test B'));

    // The table gives way to a loading line while the new category's rows arrive.
    expect(await screen.findByText('Merchant Three')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Merchant One' })).not.toBeInTheDocument()
    );
    expect(pageRoot()).not.toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('reloads an open category for the new month and closes the drawer', async () => {
    render(<AnalyticsPage />);
    await expand('Test A');
    await openRow('Merchant One');
    const previous = monthKey(-1);

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));

    await waitFor(() =>
      expect(
        log.some(
          (c) => c.startsWith('GET /api/transactions?') && c.includes(`startDate=${previous}`)
        )
      ).toBe(true)
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Merchant One' })).not.toBeInTheDocument()
    );
  });

  it('ignores a slower answer for the month you already left', async () => {
    let release = () => {};
    gates.set(
      monthKey(-1),
      new Promise((resolve) => {
        release = resolve;
      })
    );
    render(<AnalyticsPage />);
    await expand('Test A');
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await within(await screen.findByRole('table')).findByText('Merchant One');

    store = store.filter((t) => t.id === 't3');
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(within(rowsTable()).getByText('Merchant One')).toBeInTheDocument();
  });
});
