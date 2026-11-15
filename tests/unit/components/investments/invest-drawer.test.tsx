import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvestDrawer } from '@/components/investments/invest-drawer';
import type { InvestPlan, PlanRow } from '@/lib/investments/targets/planner';

const fund = (ticker: string, over: Record<string, unknown> = {}) => ({
  securityId: `sec-${ticker}`,
  ticker,
  name: `${ticker} Fund`,
  currency: 'USD',
  price: 81.79,
  priceDate: '2026-11-14',
  stale: false,
  ...over,
});

function makeRow(over: Partial<PlanRow> = {}): PlanRow {
  return {
    key: 'r-us',
    name: 'US',
    className: 'Stocks',
    fund: fund('VTI'),
    current: 5000,
    currentPct: 0.4,
    targetPct: 0.45,
    trade: 589.2,
    afterPct: 0.43,
    shares: 7.201,
    holdings: [],
    ...over,
  };
}

const fixed = makeRow({
  key: 'c-fixed',
  name: 'Fixed income',
  className: null,
  fund: fund('BND'),
  trade: 410.8,
  shares: 5.0,
  targetPct: 0.15,
});

function makePlan(over: Record<string, unknown> = {}): InvestPlan {
  return {
    ready: true,
    baseCurrency: 'USD',
    amount: 1000,
    sells: false,
    countedTotal: 12000,
    accountsCounted: 2,
    rows: [makeRow(), fixed],
    leftOut: [],
    rates: [],
    totals: { countryWeightPct: 100, classPct: 100 },
    pricesAsOf: null,
    ...over,
  } as InvestPlan;
}

let reply: (url: URL) => InvestPlan;

beforeEach(() => {
  reply = () => makePlan();
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url), 'http://localhost');
    return { ok: true, status: 200, json: async () => reply(u) } as Response;
  }) as unknown as typeof fetch;
});

const requested = () => vi.mocked(global.fetch).mock.calls.map(([u]) => String(u));
const type = async (text: string) => {
  const field = screen.getByLabelText('Amount to invest');
  await userEvent.clear(field);
  if (text) await userEvent.type(field, text);
};

describe('InvestDrawer', () => {
  it('buy list: fetches the amount and renders each row', async () => {
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    expect(await screen.findByText('Buy list')).toBeInTheDocument();
    expect(requested()).toContain('/api/investments/targets/plan?amount=1000');
    expect(screen.getByText('VTI')).toBeInTheDocument();
    expect(screen.getByText('Stocks · US')).toBeInTheDocument();
    expect(screen.getByText('$589.20')).toBeInTheDocument();
    expect(screen.getByText('7.201 sh @ $81.79')).toBeInTheDocument();
    expect(screen.getByText('BND')).toBeInTheDocument();
    expect(screen.getByText('Fixed income')).toBeInTheDocument();
    expect(
      screen.getByText('Toward your targets · 2 accounts counted · $12,000 counted')
    ).toBeInTheDocument();
  });

  it('quick amounts fill the field', async () => {
    render(<InvestDrawer open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '$2,500' }));
    expect(screen.getByLabelText('Amount to invest')).toHaveValue('2500');
    await waitFor(() => expect(requested()).toContain('/api/investments/targets/plan?amount=2500'));
  });

  it('empty amount shows where you stand', async () => {
    reply = () => makePlan({ amount: 0 });
    render(<InvestDrawer open onClose={() => {}} />);
    expect(await screen.findByText('Where you stand')).toBeInTheDocument();
    expect(requested()).toContain('/api/investments/targets/plan?amount=0');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('sells switch refetches with sells=1 and shows a sell with its holdings', async () => {
    reply = (url) =>
      url.searchParams.get('sells')
        ? makePlan({
            sells: true,
            rows: [
              makeRow({
                trade: -400,
                shares: null,
                holdings: [
                  {
                    accountId: 'a1',
                    securityId: 's1',
                    label: 'VTI',
                    accountName: 'Brokerage',
                    value: 5000,
                  },
                ],
              }),
            ],
          })
        : makePlan();
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    await screen.findByText('Buy list');
    await userEvent.click(screen.getByRole('switch', { name: 'Allow sells' }));
    expect(await screen.findByText('Rebalance')).toBeInTheDocument();
    expect(requested()).toContain('/api/investments/targets/plan?amount=1000&sells=1');
    expect(screen.getByText('Sell $400.00')).toBeInTheDocument();
    expect(screen.getByText('pick from below')).toBeInTheDocument();
    expect(screen.getByText('What you hold here')).toBeInTheDocument();
    expect(screen.getByText('Brokerage', { exact: false })).toBeInTheDocument();
  });

  it('missing fund and no price', async () => {
    reply = () =>
      makePlan({
        rows: [
          makeRow({ fund: null, shares: null }),
          makeRow({ key: 'x', fund: fund('NOP', { price: null, priceDate: null }), shares: null }),
        ],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    expect(await screen.findByText('Pick a fund to buy')).toBeInTheDocument();
    expect(screen.getByText('No price yet')).toBeInTheDocument();
  });

  it('stale price shows its date in the accent colour', async () => {
    reply = () =>
      makePlan({
        rows: [makeRow({ fund: fund('VTI', { stale: true, priceDate: '2026-10-05' }) })],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    expect(await screen.findByText('price from Oct 5')).toHaveClass('text-[var(--accent)]');
  });

  it('notes: scale, price date and targets already over', async () => {
    reply = () =>
      makePlan({
        pricesAsOf: '2026-11-14',
        totals: { countryWeightPct: 99.34, classPct: 100 },
        rows: [makeRow({ trade: 0, shares: null })],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    expect(
      await screen.findByText('Your country weights add to 99.34%; scaled to 100%.')
    ).toBeInTheDocument();
    expect(screen.getByText('Prices from Nov 14 close.')).toBeInTheDocument();
    expect(
      screen.getByText('Targets already over get nothing. Turn on sells to rebalance fully.')
    ).toBeInTheDocument();
    expect(screen.getByText('over target')).toBeInTheDocument();
  });

  it('left out expands to show each item', async () => {
    reply = () =>
      makePlan({
        leftOut: [
          {
            accountId: 'a1',
            securityId: null,
            label: 'Old RRSP',
            reason: 'typed_balance',
            value: 500,
          },
          {
            accountId: 'a2',
            securityId: 's1',
            label: 'Cash · Brokerage',
            reason: 'cash',
            value: 250,
          },
        ],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    const toggle = await screen.findByRole('button', { name: /Left out/ });
    expect(within(toggle).getByText('$750 · 2 items')).toBeInTheDocument();
    expect(screen.queryByText('Old RRSP')).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByText('Old RRSP')).toBeInTheDocument();
    expect(screen.getByText('Typed-in balance, no funds to count')).toBeInTheDocument();
    expect(screen.getByText('Cash waiting to be invested')).toBeInTheDocument();
  });

  it('hides Left out when nothing is left out', async () => {
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    await screen.findByText('Buy list');
    expect(screen.queryByRole('button', { name: /Left out/ })).toBeNull();
  });

  it('not ready shows the empty state and a link to the targets', async () => {
    reply = () => ({ ready: false, reason: 'no_class_targets' });
    render(<InvestDrawer open onClose={() => {}} />);
    expect(await screen.findByText('Set your investing targets first')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Edit investing targets/ });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/settings?tab=targets');
    expect(
      within(screen.getByText('Set your investing targets first').closest('div')!).getByRole('link')
    ).toBeInTheDocument();
  });

  it('shows one note per converted currency', async () => {
    reply = () =>
      makePlan({
        rates: [
          { currency: 'CAD', rate: 0.72 },
          { currency: 'GBP', rate: 1.27014 },
        ],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    expect(await screen.findByText('CAD converted at 0.72.')).toBeInTheDocument();
    expect(screen.getByText('GBP converted at 1.27.')).toBeInTheDocument();
  });

  it('left out rows with the same label do not collide on keys', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reply = () =>
      makePlan({
        leftOut: [
          { accountId: 'a1', securityId: 's1', label: 'Cash · Q', reason: 'cash', value: 5 },
          { accountId: 'a1', securityId: 's2', label: 'Cash · Q', reason: 'cash', value: 7 },
        ],
        sells: true,
        rows: [
          makeRow({
            trade: -50,
            holdings: [
              { accountId: 'a1', securityId: 's1', label: 'VTI', accountName: 'Q', value: 1 },
              { accountId: 'a2', securityId: 's1', label: 'VTI', accountName: 'Q', value: 2 },
            ],
          }),
        ],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    await userEvent.click(await screen.findByRole('button', { name: /Left out/ }));
    expect(screen.getAllByText('Cash · Q')).toHaveLength(2);
    expect(screen.getAllByText('VTI · Q')).toHaveLength(2);
    const keyWarnings = error.mock.calls.filter((c) => String(c[0]).includes('same key'));
    error.mockRestore();
    expect(keyWarnings).toEqual([]);
  });

  it('shows a dash instead of "over target" for a 0% target', async () => {
    reply = () =>
      makePlan({
        rows: [makeRow({ trade: 0, shares: null, targetPct: 0, name: 'Crypto', className: null })],
      });
    render(<InvestDrawer open onClose={() => {}} />);
    await type('1000');
    await screen.findByText('Buy list');
    expect(screen.queryByText('over target')).toBeNull();
  });

  it('uses the base currency for the prefix and quick amounts', async () => {
    reply = () => makePlan({ baseCurrency: 'CAD' });
    render(<InvestDrawer open onClose={() => {}} />);
    await screen.findByText('Buy list');
    expect(screen.getByRole('button', { name: 'CA$2,500' })).toBeInTheDocument();
    expect(screen.getByText('CA$', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '$2,500' })).toBeNull();
  });

  it('does not fetch while closed', () => {
    render(<InvestDrawer open={false} onClose={() => {}} />);
    expect(requested()).toEqual([]);
  });
});
