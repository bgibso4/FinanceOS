'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import type { buildSeries, ChartPoint } from '@/lib/analytics-series';
import { fmtMoney } from '@/lib/currency';
import { fmtCalendarDay } from '@/lib/dates';
import { prefersReducedMotion } from '@/lib/motion';
import { changeText } from './change';

type Series = ReturnType<typeof buildSeries>;

type OverTimeChartProps = {
  series: Series;
  daily: boolean;
  running: boolean;
  onRunning(v: boolean): void;
  split: boolean;
  onSplit(v: boolean): void;
  canSplit: boolean;
  summary: string | null;
};

const SPLIT_HINT = 'Pick 2–6 categories to compare';

/** "$3,470 so far · Oct was at $3,558 by this day (−$88) and ended at $5,425" */
export function soFarSentence(
  s: { now: number; thenSameDay: number; thenTotal: number },
  compareLabel: string
): string {
  const { amount } = changeText(s.now, s.thenSameDay);
  return `${fmtMoney(s.now)} so far · ${compareLabel} was at ${fmtMoney(s.thenSameDay)} by this day (${amount}) and ended at ${fmtMoney(s.thenTotal)}`;
}

/** "$4,980 in Oct 2026 · Sep was $5,210" */
export function finishedSentence(
  total: number,
  label: string,
  compare: { label: string; total: number }
): string {
  return `${fmtMoney(total)} in ${label} · ${compare.label} was ${fmtMoney(compare.total)}`;
}

const TICK = { fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' };

const compactMoney = (v: number) =>
  Math.abs(v) >= 1000 ? `$${Number((v / 1000).toFixed(1))}k` : fmtMoney(v);

const lastIndex = (points: ChartPoint[], key: string) =>
  points.reduce((last, p, k) => (p.values[key] == null ? last : k), -1);

/** One segmented switch: two labelled buttons, the active one raised. */
function Seg({
  options,
}: {
  options: { label: string; on: boolean; onClick(): void; disabled?: boolean; title?: string }[];
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-[var(--border-hover)] p-0.5">
      {options.map((o) => (
        <button
          key={o.label}
          aria-pressed={o.on}
          className={`whitespace-nowrap rounded-md px-[9px] py-[3px] text-xs disabled:cursor-not-allowed disabled:opacity-45 ${
            o.on
              ? 'bg-[var(--bg-elevated)] font-medium text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)]'
          }`}
          disabled={o.disabled}
          title={o.title}
          type="button"
          onClick={o.onClick}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Spending over time: a running total by day, or one point per month, against the comparison. */
export function OverTimeChart({
  series,
  daily,
  running,
  onRunning,
  split,
  onSplit,
  canSplit,
  summary,
}: OverTimeChartProps) {
  const { points, lines, todayIndex } = series;
  const cumulative = daily || running;
  const longSpan = points.length > 12;
  const data = points.map((p, k) => ({
    ...p,
    // Daily x is day-of-period: the comparison can run past this month's last date.
    tick: daily ? String(k + 1) : fmtCalendarDay(`${p.x}-01`, { month: 'short' }),
    full: daily ? `Day ${k + 1}` : fmtCalendarDay(`${p.x}-01`, { month: 'short', year: 'numeric' }),
  }));
  if (!daily && longSpan) for (const d of data) d.tick = `${d.tick} ${d.x.slice(2, 4)}`;

  const total = (key: string) => {
    const vals = points.map((p) => p.values[key]).filter((v): v is number => v != null);
    return cumulative ? (vals[vals.length - 1] ?? 0) : vals.reduce((s, v) => s + v, 0);
  };
  const title = daily
    ? split
      ? 'Spending so far, by category'
      : 'Spending so far'
    : running
      ? 'Running total'
      : 'Trend · by month';
  const animate = !prefersReducedMotion();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-[var(--text-secondary)]">{title}</span>
        <div className="flex gap-1.5">
          {!daily && (
            <Seg
              options={[
                { label: 'Per month', on: !running, onClick: () => onRunning(false) },
                { label: 'Running total', on: running, onClick: () => onRunning(true) },
              ]}
            />
          )}
          <Seg
            options={[
              { label: 'Total', on: !split, onClick: () => onSplit(false) },
              {
                label: 'Each category',
                on: split,
                onClick: () => onSplit(true),
                disabled: !canSplit,
                title: canSplit ? undefined : SPLIT_HINT,
              },
            ]}
          />
        </div>
      </div>

      {summary && <p className="mt-2 text-[13px] text-[var(--text-secondary)]">{summary}</p>}

      <div className="mt-3.5 h-[190px]">
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid-line)" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="tick"
              interval="preserveStartEnd"
              minTickGap={16}
              tick={TICK}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={TICK}
              tickFormatter={compactMoney}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-hover)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
              }}
              formatter={(v) => fmtMoney(Number(v))}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ''}
              labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
            />
            {todayIndex !== null && (
              <ReferenceLine
                label={{ value: 'Today', position: 'top', fill: 'var(--text-muted)', fontSize: 10 }}
                stroke="var(--text-muted)"
                strokeDasharray="3 3"
                x={data[todayIndex].tick}
              />
            )}
            {lines.map((l) => {
              const shared = {
                dataKey: (d: ChartPoint) => d.values[l.key],
                dot: false,
                isAnimationActive: animate,
                name: l.label,
                stroke: l.color,
                strokeLinecap: 'round' as const,
                strokeLinejoin: 'round' as const,
                type: 'linear' as const,
              };
              if (l.dashed)
                return <Line {...shared} key={l.key} strokeDasharray="5 5" strokeWidth={1.75} />;
              // Only a lone current line gets the light fill; split lines would muddy each other.
              return split ? (
                <Line {...shared} key={l.key} strokeWidth={2.5} />
              ) : (
                <Area {...shared} key={l.key} fill={l.color} fillOpacity={0.09} strokeWidth={2.5} />
              );
            })}
            {lines
              .filter((l) => !l.dashed)
              .map((l) => {
                const k = lastIndex(points, l.key);
                return k < 0 ? null : (
                  <ReferenceDot
                    key={`dot-${l.key}`}
                    fill={l.color}
                    r={4.5}
                    stroke="var(--bg-card)"
                    strokeWidth={3}
                    x={data[k].tick}
                    y={points[k].values[l.key]!}
                  />
                );
              })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ul
        aria-label="Legend"
        className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-[var(--text-secondary)]"
      >
        {lines.map((l) => (
          <li key={l.key} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={`inline-block h-[9px] w-[9px] rounded-sm ${l.dashed ? 'opacity-60' : ''}`}
              style={{ background: l.color }}
            />
            <span>{l.dashed ? `${l.label} (dashed)` : l.label}</span>
            {split && (
              <span className="font-mono text-[var(--text-muted)]">{fmtMoney(total(l.key))}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
