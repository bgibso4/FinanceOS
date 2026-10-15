import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ValueChart, Sparkline } from '@/components/investments/value-chart';
import { ChangeChip, Notice, SourcePill, StatusDot } from '@/components/investments/pills';
import { HoldingsMap } from '@/components/investments/holdings-map';
import { AllocationBars } from '@/components/investments/allocation-bars';
import { HoldingsTable } from '@/components/investments/holdings-table';
import { ActivityList } from '@/components/investments/activity-list';
import type { HoldingLine } from '@/lib/investments/holdings-view';
import { BalanceSource } from '@/lib/investments/codes';

const point = (date: string, value: number, isEstimated = false) => ({ date, value, isEstimated });

const line = (over: Partial<HoldingLine>): HoldingLine => ({
  key: 's1',
  label: 'AAA',
  name: 'Triple A Fund',
  kind: 'security',
  securityId: 's1',
  quantity: 12.5,
  valueBase: 1500,
  gainBase: 250,
  rangeChangePct: 3.2,
  accountCount: 1,
  weightPct: 60,
  members: [],
  ...over,
});

describe('ValueChart', () => {
  it('shows a placeholder when the range has under two points', () => {
    render(<ValueChart currency="USD" from="2026-10-01" points={[point('2026-10-09', 5)]} />);
    expect(screen.getByText('Not enough history in this range yet.')).toBeInTheDocument();
  });

  it('puts a two-digit year on the axis dates when asked', () => {
    render(
      <ValueChart
        yearLabels
        currency="USD"
        from="2025-10-13"
        points={[point('2025-10-13', 1), point('2026-10-13', 2)]}
      />
    );
    expect(screen.getAllByText('Oct 13, 25')).toHaveLength(2);
    expect(screen.getByText('Oct 13, 26')).toBeInTheDocument();
  });

  it('draws solid and dashed segments with start, middle and end labels', () => {
    render(
      <ValueChart
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 1), point('2026-10-02', 2, true), point('2026-10-03', 3)]}
      />
    );
    expect(screen.getByTestId('chart-dashed').getAttribute('d')).not.toBe('');
    expect(screen.getByTestId('chart-end')).toBeInTheDocument();
    expect(screen.getByText('Oct 1')).toBeInTheDocument();
    expect(screen.getByText('Oct 2')).toBeInTheDocument();
    expect(screen.getByText('Oct 3')).toBeInTheDocument();
  });

  it('marks manual entries', () => {
    render(
      <ValueChart
        manual
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 1), point('2026-10-02', 1, true), point('2026-10-03', 2)]}
      />
    );
    expect(screen.getAllByTestId('chart-entry')).toHaveLength(1);
  });
});

describe('ValueChart hover', () => {
  const pts = [point('2026-10-01', 100), point('2026-10-02', 120, true), point('2026-10-03', 150)];
  const plot = () => {
    const el = screen.getByTestId('chart-plot');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 820,
      height: 170,
      right: 820,
      bottom: 170,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return el;
  };

  it('shows the nearest day’s date, value and status, and hides on leave', () => {
    render(<ValueChart currency="USD" from="2026-10-01" points={pts} />);
    const el = plot();
    fireEvent.pointerMove(el, { clientX: 400 });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Fri, Oct 2, 2026');
    expect(tip).toHaveTextContent('$120');
    expect(tip).toHaveTextContent('Estimated');
    fireEvent.pointerLeave(el);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('labels a manual account’s days Entered or Carried forward', () => {
    render(<ValueChart manual currency="USD" from="2026-10-01" points={pts} />);
    const el = plot();
    fireEvent.pointerMove(el, { clientX: 820 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Entered');
    fireEvent.pointerMove(el, { clientX: 410 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Carried forward');
  });

  it('leaves the part of the range before the first point empty, without hover', () => {
    render(<ValueChart currency="USD" from="2026-09-21" points={pts} />);
    expect(screen.getByText('No history before Oct 1')).toBeInTheDocument();
    expect(screen.getByText('Sep 21')).toBeInTheDocument();
    expect(screen.getByText('Sep 27')).toBeInTheDocument();
    fireEvent.pointerMove(plot(), { clientX: 100 });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows a repeated y-axis label once', () => {
    const flat = [point('2026-10-01', 5000), point('2026-10-05', 5000), point('2026-10-09', 5000)];
    render(<ValueChart currency="USD" from="2026-10-01" points={flat} />);
    expect(within(screen.getByTestId('chart-y-axis')).getAllByText('$5.0k')).toHaveLength(1);
  });

  const axisLabels = () =>
    within(screen.getByTestId('chart-y-axis'))
      .getAllByText(/\$/)
      .map((e) => e.textContent);

  it('labels the three gridlines with the values there, recomputed with the points', () => {
    const { rerender } = render(
      <ValueChart
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 1000), point('2026-10-02', 3000)]}
      />
    );
    expect(axisLabels()).toEqual(['$2.6k', '$2.0k', '$1.4k']);
    rerender(
      <ValueChart
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 100_000), point('2026-10-02', 300_000)]}
      />
    );
    expect(axisLabels()).toEqual(['$255k', '$200k', '$145k']);
  });

  it('labels a manual account’s axis from its lowered floor', () => {
    render(
      <ValueChart
        manual
        currency="USD"
        from="2026-10-01"
        points={[
          point('2026-10-01', 1000),
          point('2026-10-02', 1000, true),
          point('2026-10-03', 1000),
        ]}
      />
    );
    // yMin = 80% of the last value: the plot spans $800–$1,000.
    expect(axisLabels()).toEqual(['$955', '$900', '$845']);
  });

  it('gives the gap note the axis’s year on long ranges', () => {
    render(<ValueChart yearLabels currency="USD" from="2025-09-21" points={pts} />);
    expect(screen.getByText('No history before Oct 1, 26')).toBeInTheDocument();
  });

  it('drops the hover when the points shrink under the pointer', () => {
    const { rerender } = render(<ValueChart currency="USD" from="2026-10-01" points={pts} />);
    fireEvent.pointerMove(plot(), { clientX: 820 });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    rerender(<ValueChart currency="USD" from="2026-10-01" points={pts.slice(0, 2)} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders an empty slot without enough points', () => {
    const { container } = render(<Sparkline points={[]} tone="up" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('pills', () => {
  it('labels sources, changes, dots and notices', () => {
    render(
      <>
        <SourcePill source={BalanceSource.Valuation} />
        <SourcePill source={BalanceSource.Provider} />
        <ChangeChip change={{ start: 100, end: 110, delta: 10, pct: 10 }} currency="USD" />
        <StatusDot title="Waiting on Test Brokerage" tone="warn" />
        <Notice
          action={<button type="button">Retry</button>}
          lead="Prices are from Oct 6."
          text="The price source didn’t respond."
          tone="warn"
        />
      </>
    );
    expect(screen.getByText('Valued')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText('↗ $10 · +10.0%')).toBeInTheDocument();
    expect(screen.getByLabelText('Waiting on Test Brokerage')).toBeInTheDocument();
    expect(screen.getByText('Prices are from Oct 6.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('HoldingsMap', () => {
  it('draws a tile per line with a tooltip', () => {
    render(
      <HoldingsMap
        currency="USD"
        height={250}
        lines={[
          line({}),
          line({ key: 's2', label: 'BBB', name: 'B Fund', valueBase: 1000, weightPct: 40 }),
        ]}
      />
    );
    expect(screen.getByTitle('Triple A Fund · $1,500 · 60.0% of portfolio')).toBeInTheDocument();
    expect(screen.getByText('BBB')).toBeInTheDocument();
  });
  it('lays tiles out on the container’s shape, not a stretched canvas', () => {
    const { container } = render(
      <HoldingsMap
        currency="USD"
        height={250}
        lines={['A', 'B', 'C', 'D'].map((k) =>
          line({ key: k, label: k, valueBase: 100, weightPct: 25 })
        )}
      />
    );
    const tiles = [...container.querySelectorAll<HTMLElement>('[title]')];
    // Four equal holdings in a ~470×250 box form a 2×2 grid, not a 1×4 strip.
    expect(tiles.map((t) => [t.style.left, t.style.top])).toEqual([
      ['0%', '0px'],
      ['0%', '125px'],
      ['50%', '0px'],
      ['50%', '125px'],
    ]);
    expect(tiles[0].style.width).toBe('calc(50% - 3px)');
  });
  it('leaves out a holding too small to draw, so no tile spills out of the map', () => {
    render(
      <HoldingsMap
        currency="USD"
        height={200}
        lines={[
          line({ key: 'a', label: 'AAA', name: 'A Fund', valueBase: 9000 }),
          line({ key: 'b', label: 'BBB', name: 'B Fund', valueBase: 5000 }),
          line({ key: 'c', label: 'CCC', name: 'C Fund', valueBase: 1000 }),
          line({ key: 'd', label: 'DDD', name: 'Dust Fund', valueBase: 5 }),
        ]}
      />
    );
    expect(screen.getByTitle(/^C Fund/)).toBeInTheDocument();
    expect(screen.queryByTitle(/^Dust Fund/)).not.toBeInTheDocument();
  });
  it('gives label-less tiles no padding, so a narrow one keeps its laid-out width', () => {
    render(
      <HoldingsMap
        currency="USD"
        height={200}
        lines={[
          line({ key: 'a', label: 'AAA', name: 'A Fund', valueBase: 9000 }),
          line({ key: 'b', label: 'BBB', name: 'B Fund', valueBase: 100 }),
        ]}
      />
    );
    const narrow = screen.getByTitle(/^B Fund/);
    expect(narrow).toHaveTextContent('');
    expect(narrow.className).not.toMatch(/\bp[xy]-/);
    expect(screen.getByText('AAA')).toHaveClass('truncate');
  });
});

describe('AllocationBars', () => {
  it('lists slices with one-decimal shares', () => {
    render(
      <AllocationBars
        slices={[
          { label: 'ETF', value: 60, pct: 60 },
          { label: 'Cash & MM', value: 40, pct: 40 },
        ]}
      />
    );
    expect(screen.getByText('ETF')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });
});

describe('HoldingsTable', () => {
  const accounts = [
    { id: 'a1', name: 'Roth IRA', institution: 'Example Brokerage' },
    { id: 'a2', name: 'Taxable', institution: 'Example Brokerage' },
  ];
  const spread = line({
    accountCount: 2,
    members: [
      { accountId: 'a1', quantity: 10, valueBase: 1000, gainBase: 200, weightPct: 40 },
      { accountId: 'a2', quantity: 2.5, valueBase: 500, gainBase: 50, weightPct: 20 },
    ],
  });
  const single = line({
    key: 's2',
    securityId: 's2',
    label: 'ZZZ',
    gainBase: null,
    quantity: null,
    weightPct: 40,
    members: [{ accountId: 'a1', quantity: null, valueBase: 1000, gainBase: null, weightPct: 40 }],
  });

  it('shows value, gain and weight, a dash for unknown gain, and no pills', () => {
    render(
      <HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread, single]} />
    );
    expect(screen.queryByText('2 accounts')).toBeNull();
    expect(screen.queryByText('No price source')).toBeNull();
    expect(screen.getByText('+$250')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('12.5 · Triple A Fund')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('gives only a line held in several accounts a chevron, and lists its accounts when opened', async () => {
    render(
      <HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread, single]} />
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const row = screen.getByRole('button', { name: /AAA/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('holding-member')).toBeNull();
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const [roth, taxable] = screen.getAllByTestId('holding-member');
    expect(within(roth).getByText('Roth IRA')).toBeInTheDocument();
    expect(within(roth).getByText('Example Brokerage · 10')).toBeInTheDocument();
    expect(within(roth).getByText('$1,000')).toBeInTheDocument();
    expect(within(roth).getByText('+$200')).toBeInTheDocument();
    expect(within(roth).getByText('40.0%')).toBeInTheDocument();
    expect(within(taxable).getByText('Example Brokerage · 2.5')).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.queryByTestId('holding-member')).toBeNull();
  });

  it('offers nothing to expand in a single-account view and uses whole-number weights', () => {
    render(
      <HoldingsTable accounts={accounts} currency="USD" lines={[spread]} multiAccount={false} />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('keeps a line open when the lines are replaced, as on a range change', async () => {
    const { rerender } = render(
      <HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread]} />
    );
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    const moved = {
      ...spread,
      valueBase: 1600,
      members: [{ ...spread.members[0], valueBase: 1100 }, spread.members[1]],
    };
    rerender(<HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[moved]} />);
    expect(screen.getAllByTestId('holding-member')).toHaveLength(2);
    expect(screen.getByText('$1,100')).toBeInTheDocument();
  });

  it('drops the chevron when a reload leaves the line in one account', async () => {
    const { rerender } = render(
      <HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread]} />
    );
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    const narrowed = { ...spread, accountCount: 1, members: [spread.members[0]] };
    rerender(<HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[narrowed]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('holding-member')).toBeNull();
  });
});

describe('ActivityList', () => {
  const item = {
    id: 't1',
    accountId: 'a1',
    date: '2026-10-05',
    title: 'Buy · AAA',
    trade: { quantity: 1, price: 5 },
    amount: -5,
    currency: 'USD',
  };

  it('shows the empty copy', () => {
    render(<ActivityList emptyText="No activity reported." items={[]} />);
    expect(screen.getByText('No activity reported.')).toBeInTheDocument();
  });

  it('prefixes the account in the all-accounts view and signs amounts', () => {
    render(<ActivityList emptyText="" items={[item]} sourceOf={() => 'Brokerage · Test Bank'} />);
    const row = screen.getByText('Buy · AAA').closest('.grid') as HTMLElement;
    expect(within(row).getByText('Brokerage · Test Bank · 1 sh @ $5.00')).toBeInTheDocument();
    expect(within(row).getByText('−$5.00')).toBeInTheDocument();
    expect(within(row).getByText('Oct 5')).toBeInTheDocument();
  });

  it('shows amounts and prices in the transaction currency', () => {
    render(
      <ActivityList
        emptyText=""
        items={[
          { ...item, trade: { quantity: 1234.5, price: 7.5 }, amount: 12.25, currency: 'CAD' },
        ]}
      />
    );
    expect(screen.getByText('1,234.5 sh @ CA$7.50')).toBeInTheDocument();
    expect(screen.getByText('CA$12.25')).toBeInTheDocument();
  });
});
