import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecuritiesTab } from '@/components/investments/securities-tab';
import { Pricing, SecurityType } from '@/lib/investments/codes';
import type { SecurityList } from '@/lib/investments/security-list';
import { makeSecurityItem } from '../../../helpers/investment-overview';

const LIST: SecurityList = {
  symbolHint: 'Use test symbols.',
  securities: [
    makeSecurityItem({ id: 'sec-aaa', label: 'AAA', name: 'Triple A Fund', heldIn: 2 }),
    makeSecurityItem({
      id: 'sec-cash',
      label: 'CAD cash',
      name: 'Canadian Dollar',
      type: SecurityType.Cash,
      currency: 'CAD',
      pricing: Pricing.Fixed,
      priceSymbol: null,
      fixedPrice: 1,
      latest: { price: 1, date: null },
    }),
    makeSecurityItem({
      id: 'sec-old',
      label: 'OLDF',
      name: 'Legacy Balanced Fund',
      type: SecurityType.MutualFund,
      pricing: Pricing.None,
      priceSymbol: 'OLDF',
      latest: null,
      heldIn: 0,
    }),
    makeSecurityItem({
      id: 'sec-plan',
      label: 'PLAN',
      name: 'Example Plan Trust',
      type: SecurityType.MutualFund,
      pricing: Pricing.Institution,
      priceSymbol: null,
      proxySymbol: 'PRXY',
      latest: { price: 28.5, date: '2026-10-06' },
    }),
  ],
};

let list: SecurityList;
let listStatus: number;
const scrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  list = LIST;
  listStatus = 200;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    if (key === 'GET /api/investments/securities') {
      return { ok: listStatus < 400, status: listStatus, json: async () => list } as Response;
    }
    if (key.startsWith('PATCH /api/investments/securities/')) {
      return { ok: true, status: 200, json: async () => ({ security: {} }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: 'Not mocked' }) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

const urls = () =>
  vi.mocked(global.fetch).mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);
const row = (label: string) => screen.getByRole('listitem', { name: label });
const shown = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
const ready = () => screen.findByRole('listitem', { name: 'AAA' });

describe('SecuritiesTab', () => {
  it('shows each security’s type, accounts, price source and latest price', async () => {
    render(<SecuritiesTab focusId={null} />);
    const aaa = await ready();
    for (const text of ['Triple A Fund', 'ETF', '2 accounts', 'Market · AAA', '$110.00', 'Oct 8']) {
      expect(within(aaa).getByText(text)).toBeInTheDocument();
    }
    const edit = within(aaa).getByRole('button', { name: 'Change how AAA is priced' });
    expect(edit).toHaveAttribute('title', 'Change how AAA is priced');

    const plan = row('PLAN');
    expect(within(plan).getByText('Fund')).toBeInTheDocument();
    expect(within(plan).getByText('1 account')).toBeInTheDocument();
    expect(within(plan).getByText('Institution · follows PRXY')).toBeInTheDocument();
    expect(within(plan).getByText('$28.50')).toBeInTheDocument();

    const old = row('OLDF');
    expect(within(old).getByText('Not held')).toBeInTheDocument();
    expect(within(old).getByText('No price source')).toHaveClass('text-[var(--accent)]');
    expect(within(old).getByText('Valued at its last known price')).toBeInTheDocument();
    expect(within(old).getByText('—')).toBeInTheDocument();

    const cash = row('CAD cash');
    expect(within(cash).getByText('Cash')).toBeInTheDocument();
    expect(within(cash).getByText('Fixed · CA$1.00')).toBeInTheDocument();
    expect(within(cash).getAllByText('CAD cash')).toHaveLength(1);
    expect(within(cash).queryByText('Canadian Dollar')).toBeNull();
    expect(within(cash).queryByRole('button')).toBeNull();
  });

  it('filters to securities that need attention, with both counts', async () => {
    render(<SecuritiesTab focusId={null} />);
    await ready();
    const all = screen.getByRole('button', { name: 'All · 4' });
    const attention = screen.getByRole('button', { name: 'Needs attention · 1' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(attention);
    expect(attention).toHaveAttribute('aria-pressed', 'true');
    expect(shown()).toEqual(['OLDF']);
    await userEvent.click(all);
    expect(shown()).toEqual(['AAA', 'CAD cash', 'OLDF', 'PLAN']);
  });

  it('searches ticker or name, ignoring case', async () => {
    render(<SecuritiesTab focusId={null} />);
    await ready();
    const search = screen.getByPlaceholderText('Search ticker or name');
    await userEvent.type(search, 'TRUST');
    expect(shown()).toEqual(['PLAN']);
    await userEvent.clear(search);
    await userEvent.type(search, 'aa');
    expect(shown()).toEqual(['AAA']);
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No securities match.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'All · 4' })).toBeInTheDocument();
  });

  it('explains an empty list', async () => {
    list = { securities: [], symbolHint: 'Use test symbols.' };
    render(<SecuritiesTab focusId={null} />);
    expect(
      await screen.findByText(
        'No securities yet. They appear once an investment account has holdings or trades.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search ticker or name')).toBeNull();
  });

  it('highlights and scrolls to the deep-linked security until the next click', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<SecuritiesTab focusId="sec-plan" />);
    const plan = await screen.findByRole('listitem', { name: 'PLAN' });
    expect(plan).toHaveAttribute('aria-current', 'true');
    expect(plan).toHaveClass('ring-[var(--accent)]');
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ block: 'center' }));
    expect(scrolled.mock.contexts[0]).toBe(plan);
    expect(screen.getByRole('button', { name: 'Needs attention · 1' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(shown()).toHaveLength(4);
    await userEvent.click(document.body);
    expect(plan).not.toHaveAttribute('aria-current');
    expect(plan).not.toHaveClass('ring-[var(--accent)]');
  });

  it('opens the price window, and a save closes it, reloads the list and syncs', async () => {
    const synced = vi.fn();
    window.addEventListener('financeos-sync-trigger', synced);
    render(<SecuritiesTab focusId={null} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change how PLAN is priced' }));
    expect(screen.getByRole('heading', { name: 'How PLAN is priced' })).toBeInTheDocument();
    expect(screen.getByText('Currently').parentElement).toHaveTextContent(
      'Currently Institution · follows PRXY · $28.50 on Oct 6'
    );
    const fund = screen.getByLabelText(/Follow a similar fund/);
    expect(fund).toHaveValue('PRXY');

    list = {
      ...LIST,
      securities: LIST.securities.map((s) =>
        s.id === 'sec-plan' ? { ...s, proxySymbol: null } : s
      ),
    };
    await userEvent.clear(fund);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'How PLAN is priced' })).toBeNull()
    );
    expect(await within(row('PLAN')).findByText('Institution')).toBeInTheDocument();
    expect(urls()).toEqual([
      'GET /api/investments/securities',
      'PATCH /api/investments/securities/sec-plan',
      'GET /api/investments/securities',
    ]);
    await waitFor(() => expect(synced).toHaveBeenCalledTimes(1));
    window.removeEventListener('financeos-sync-trigger', synced);
  });

  it('shows a loading state until the list arrives', async () => {
    render(<SecuritiesTab focusId={null} />);
    expect(screen.getByText('Loading securities…')).toBeInTheDocument();
    await ready();
    expect(screen.queryByText('Loading securities…')).toBeNull();
  });

  it('highlights nothing and does not crash for an unknown focus id', async () => {
    render(<SecuritiesTab focusId="sec-missing" />);
    await ready();
    expect(shown()).toHaveLength(4);
    for (const li of screen.getAllByRole('listitem')) {
      expect(li).not.toHaveAttribute('aria-current');
    }
  });

  it('shows the newer load’s data when overlapping loads resolve out of order', async () => {
    const resolvers: ((l: SecurityList) => void)[] = [];
    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) =>
          resolvers.push((l) => resolve({ ok: true, status: 200, json: async () => l } as Response))
        )
    );
    // StrictMode runs the load effect twice, so two loads overlap.
    render(
      <StrictMode>
        <SecuritiesTab focusId={null} />
      </StrictMode>
    );
    await waitFor(() => expect(resolvers).toHaveLength(2));
    const newer: SecurityList = { ...LIST, securities: [LIST.securities[0]] };
    const older: SecurityList = { ...LIST, securities: [LIST.securities[1]] };
    resolvers[1](newer);
    await ready();
    resolvers[0](older);
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toEqual(['AAA']);
  });

  it('keeps the list and offers Try again when a reload fails', async () => {
    render(<SecuritiesTab focusId={null} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change how PLAN is priced' }));
    listStatus = 500;
    await userEvent.clear(screen.getByLabelText(/Follow a similar fund/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Couldn’t refresh securities\./)).toBeInTheDocument();
    expect(shown()).toEqual(['AAA', 'CAD cash', 'OLDF', 'PLAN']);
    listStatus = 200;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn’t refresh securities\./)).toBeNull());
    expect(shown()).toHaveLength(4);
  });

  it('offers Try again when the list fails to load', async () => {
    listStatus = 500;
    render(<SecuritiesTab focusId={null} />);
    expect(await screen.findByText(/Couldn’t load securities\./)).toBeInTheDocument();
    listStatus = 200;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await ready()).toBeInTheDocument();
  });
});
