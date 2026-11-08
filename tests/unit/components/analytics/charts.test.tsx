import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  OverTimeChart,
  finishedSentence,
  soFarSentence,
} from '@/components/analytics/over-time-chart';
import { WhereItWent } from '@/components/analytics/where-it-went';
import { changeText } from '@/components/analytics/change';
import type { buildSeries } from '@/lib/analytics-series';

type Series = ReturnType<typeof buildSeries>;

const series: Series = {
  points: [
    { x: '2026-11-01', values: { current: 100, compare: 80 } },
    { x: '2026-11-02', values: { current: 150, compare: 120 } },
  ],
  lines: [
    { key: 'current', label: 'Nov 2026 so far', color: 'var(--accent)', dashed: false },
    { key: 'compare', label: 'Oct', color: 'var(--text-muted)', dashed: true },
  ],
  todayIndex: 1,
};

function chart(props: Partial<Parameters<typeof OverTimeChart>[0]> = {}) {
  const onRunning = vi.fn();
  const onSplit = vi.fn();
  render(
    <OverTimeChart
      daily
      canSplit={false}
      running={false}
      series={series}
      split={false}
      summary={null}
      onRunning={onRunning}
      onSplit={onSplit}
      {...props}
    />
  );
  return { onRunning, onSplit };
}

describe('OverTimeChart', () => {
  it('showsSoFarSentence', () => {
    const text = soFarSentence({ now: 3470, thenSameDay: 3558, thenTotal: 5425 }, 'Oct');
    expect(text).toBe('$3,470 so far · Oct was at $3,558 by this day (−$88) and ended at $5,425');
    chart({ summary: text });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('finishedMonthSentence', () => {
    expect(finishedSentence(4980, 'Oct 2026', { label: 'Sep', total: 5210 })).toBe(
      '$4,980 in Oct 2026 · Sep was $5,210'
    );
  });

  it('runningSwitchOnlyWhenNotDaily', () => {
    chart({ daily: true });
    expect(screen.queryByRole('button', { name: 'Running total' })).not.toBeInTheDocument();
    expect(screen.getByText('Spending so far')).toBeInTheDocument();

    const { onRunning } = chart({ daily: false });
    expect(screen.getByText('Trend · by month')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Running total' }));
    expect(onRunning).toHaveBeenCalledWith(true);
  });

  it('eachCategoryDisabledOutsideTwoToSix', () => {
    chart({ canSplit: false });
    const off = screen.getByRole('button', { name: 'Each category' });
    expect(off).toBeDisabled();
    expect(off).toHaveAttribute('title', 'Pick 2–6 categories to compare');

    const { onSplit } = chart({ canSplit: true });
    const on = screen.getAllByRole('button', { name: 'Each category' })[1];
    expect(on).toBeEnabled();
    expect(on).not.toHaveAttribute('title');
    fireEvent.click(on);
    expect(onSplit).toHaveBeenCalledWith(true);
  });

  it('legendNamesEachLineAndMarksTheDashedOne', () => {
    chart();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Nov 2026 so far')).toBeInTheDocument();
    expect(within(legend).getByText('Oct (dashed)')).toBeInTheDocument();
  });
});

describe('WhereItWent', () => {
  it('whereItWentTopFivePlusRest', () => {
    const slices = [700, 600, 500, 400, 300, 200, 100].map((amount, i) => ({
      key: `c${i}`,
      label: `Cat ${i}`,
      amount,
      color: `#00000${i}`,
    }));
    render(<WhereItWent slices={slices} />);
    expect(screen.getByText('Where it went')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Top categories' })).getAllByRole(
      'listitem'
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      'Cat 0$700',
      'Cat 1$600',
      'Cat 2$500',
      'Cat 3$400',
      'Cat 4$300',
      'Everything else$300',
    ]);
  });

  it('showsNothingWhenThereIsNoSpend', () => {
    render(<WhereItWent slices={[]} />);
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });
});

describe('changeText', () => {
  it('emptyComparisonShowsZeroAndDash', () => {
    expect(changeText(100, 0)).toEqual({ amount: '+$100', percent: '—' });
  });

  it('signsAmountAndPercent', () => {
    expect(changeText(90, 120)).toEqual({ amount: '−$30', percent: '−25%' });
    expect(changeText(150, 100)).toEqual({ amount: '+$50', percent: '+50%' });
    expect(changeText(100, 100)).toEqual({ amount: '$0', percent: '0%' });
  });
});
