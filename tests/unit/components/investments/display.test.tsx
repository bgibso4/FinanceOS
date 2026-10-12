import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ValueChart, Sparkline } from '@/components/investments/value-chart';
import { ChangeChip, Notice, SourcePill, StatusDot } from '@/components/investments/pills';
import { HoldingsMap } from '@/components/investments/holdings-map';
import { AllocationBars } from '@/components/investments/allocation-bars';
import { HoldingsTable } from '@/components/investments/holdings-table';
import { ActivityList } from '@/components/investments/activity-list';
import type { HoldingLine } from '@/lib/investments/holdings-view';

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
  unpriced: false,
  weightPct: 60,
  ...over,
});

describe('ValueChart', () => {
  it('shows a placeholder when the range has under two points', () => {
    render(<ValueChart points={[point('2026-10-09', 5)]} />);
    expect(screen.getByText('Not enough history in this range yet.')).toBeInTheDocument();
  });

  it('draws solid and dashed segments with start, middle and end labels', () => {
    render(
      <ValueChart
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
        points={[point('2026-10-01', 1), point('2026-10-02', 1, true), point('2026-10-03', 2)]}
      />
    );
    expect(screen.getAllByTestId('chart-entry')).toHaveLength(1);
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
        <SourcePill source="valuation" />
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
  it('shows the accounts tag, unpriced flag and a dash for unknown gain', () => {
    render(
      <HoldingsTable
        multiAccount
        currency="USD"
        lines={[
          line({ accountCount: 2 }),
          line({
            key: 's2',
            label: 'ZZZ',
            unpriced: true,
            gainBase: null,
            quantity: null,
            weightPct: 40,
          }),
        ]}
      />
    );
    expect(screen.getByText('2 accounts')).toBeInTheDocument();
    expect(screen.getByText('No price source')).toBeInTheDocument();
    expect(screen.getByText('+$250')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('12.5 · Triple A Fund')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('uses whole-number weights for one account and hides the tag', () => {
    render(
      <HoldingsTable currency="USD" lines={[line({ accountCount: 2 })]} multiAccount={false} />
    );
    expect(screen.queryByText('2 accounts')).toBeNull();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });
});

describe('ActivityList', () => {
  const item = {
    id: 't1',
    accountId: 'a1',
    date: '2026-10-05',
    title: 'Buy · AAA',
    detail: '1 sh @ $5.00',
    amount: -5,
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
});
