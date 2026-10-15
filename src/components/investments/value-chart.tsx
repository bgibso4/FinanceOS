'use client';

import { useState, type PointerEvent } from 'react';
import { addDays, isoDay, utcDay } from '@/lib/investments/dates';
import type { SeriesPoint } from '@/lib/investments/history';
import { chartGeometry, GRIDLINES, gridValues, nearestIndex, tooltipSide } from './chart-geometry';
import { daysBetween, fmtCompact, fmtDay, fmtLongDay, fmtMoney } from './format';

const WIDTH = 820;
const HEIGHT = 170;
const PAD = 8;
/** Width of the y-axis label column; the x-axis dates are indented by the same amount. */
const Y_GUTTER = 52;

/** A range whose history starts more than this many days late says so in the gap. */
const GAP_NOTE_DAYS = 3;

const SERIES_LABELS = {
  manual: { exact: 'Entered', estimated: 'Carried forward' },
  synced: { exact: 'Synced', estimated: 'Estimated' },
};

/** What a recorded or estimated point is called, for the legend and the hover tooltip. */
export const seriesLabels = (manual: boolean) =>
  manual ? SERIES_LABELS.manual : SERIES_LABELS.synced;

const pointLabel = (p: SeriesPoint, manual: boolean) => {
  const labels = seriesLabels(manual);
  return p.isEstimated ? labels.estimated : labels.exact;
};

/**
 * Balance history over the range from `from`: solid where recorded, dashed where estimated, dots
 * on manual entries, and the day under the pointer in a tooltip. Values are in `currency`.
 */
export function ValueChart({
  points,
  manual = false,
  from,
  currency,
  yearLabels = false,
}: {
  points: SeriesPoint[];
  manual?: boolean;
  from: string;
  currency: string;
  /** Axis dates carry a two-digit year (ranges of a year or more). */
  yearLabels?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const last = points.at(-1)?.value ?? 0;
  const lead = points.length ? Math.max(0, daysBetween(from, points[0].date)) : 0;
  const box = {
    width: WIDTH,
    height: HEIGHT,
    pad: PAD,
    yMin: manual ? last * 0.8 : undefined,
    lead,
  };
  const geo = chartGeometry(points, box);
  if (!geo) {
    return (
      <div className="mt-3 flex h-[188px] items-center justify-center text-xs text-[var(--text-muted)]">
        Not enough history in this range yet.
      </div>
    );
  }
  const lastIndex = points.length - 1;
  const markers = geo.points.flatMap((p, i) =>
    i === lastIndex || (manual && !points[i].isEstimated) ? [{ ...p, i, end: i === lastIndex }] : []
  );
  const span = lead + lastIndex;
  const labels = [
    from,
    isoDay(addDays(utcDay(from), Math.floor(span / 2))),
    points[lastIndex].date,
  ];
  // Equal labels (a flat series, or a small span at large values) show once: first one wins.
  const seenLabels = new Set<string>();
  const axisLabels = gridValues(geo, box).map((v) => {
    const text = fmtCompact(v, currency);
    if (seenLabels.has(text)) return '';
    seenLabels.add(text);
    return text;
  });
  const track = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(
      rect.width ? nearestIndex((e.clientX - rect.left) / rect.width, points.length, lead) : null
    );
  };
  // The points can change under a resting pointer; an index past them is no hover.
  const hovered =
    hover == null || hover > lastIndex ? null : { point: points[hover], at: geo.points[hover] };
  const hoverPct = hovered ? (hovered.at.x / WIDTH) * 100 : 0;
  return (
    <div className="mt-3">
      <div className="grid" style={{ gridTemplateColumns: `${Y_GUTTER}px 1fr` }}>
        <div aria-hidden className="relative h-[170px]" data-testid="chart-y-axis">
          {GRIDLINES.map((f, i) => (
            <span
              key={f}
              className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-[var(--text-muted)]"
              style={{ top: `${f * 100}%` }}
            >
              {axisLabels[i]}
            </span>
          ))}
        </div>
        <div
          className="relative h-[170px] touch-pan-y"
          data-testid="chart-plot"
          onPointerDown={track}
          onPointerLeave={() => setHover(null)}
          onPointerMove={track}
        >
          <svg
            aria-label="Balance history"
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            role="img"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          >
            <defs>
              <linearGradient id="investment-value-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {GRIDLINES.map((f) => (
              <line
                key={f}
                stroke="var(--grid-line)"
                vectorEffect="non-scaling-stroke"
                x1={0}
                x2={WIDTH}
                y1={HEIGHT * f}
                y2={HEIGHT * f}
              />
            ))}
            <path d={geo.area} fill="url(#investment-value-fill)" />
            <path
              d={geo.solid}
              data-testid="chart-solid"
              fill="none"
              stroke="var(--accent)"
              strokeLinejoin="round"
              strokeWidth={1.8}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={geo.dashed}
              data-testid="chart-dashed"
              fill="none"
              opacity={0.6}
              stroke="var(--accent)"
              strokeDasharray="4 4"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {markers.map((m) => (
            <span
              key={m.i}
              className={`absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-[var(--accent)] ${
                m.end ? 'bg-[var(--bg-card)]' : 'bg-[var(--accent)]'
              }`}
              data-testid={m.end ? 'chart-end' : 'chart-entry'}
              style={{ left: `${(m.x / WIDTH) * 100}%`, top: m.y }}
            />
          ))}
          {lead > GAP_NOTE_DAYS && (
            <div
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-center text-[10.5px] text-[var(--text-muted)]"
              style={{ left: 0, width: `${(geo.points[0].x / WIDTH) * 100}%` }}
            >
              No history before {fmtDay(points[0].date, { year: yearLabels })}
            </div>
          )}
          {hovered && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 border-l border-[var(--border-hover)]"
                style={{ left: `${hoverPct}%` }}
              />
              <span
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-card)] bg-[var(--accent)]"
                style={{ left: `${hoverPct}%`, top: hovered.at.y }}
              />
              <div
                className={`pointer-events-none absolute top-1 whitespace-nowrap rounded-lg border border-[var(--border-hover)] bg-[var(--bg-elevated)] px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${
                  tooltipSide(hoverPct / 100) === 'left' ? '-ml-3.5 -translate-x-full' : 'ml-3.5'
                }`}
                role="tooltip"
                style={{ left: `${hoverPct}%` }}
              >
                <div className="text-[10.5px] text-[var(--text-muted)]">
                  {fmtLongDay(hovered.point.date)}
                </div>
                <div className="font-mono text-sm font-medium text-[var(--text-primary)]">
                  {fmtMoney(hovered.point.value, { currency })}
                </div>
                <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
                  <span
                    className={`inline-block h-0 w-3.5 border-t-[1.5px] border-[var(--accent)] ${
                      hovered.point.isEstimated ? 'border-dashed opacity-70' : ''
                    }`}
                  />
                  {pointLabel(hovered.point, manual)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div
        className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-muted)]"
        style={{ marginLeft: Y_GUTTER }}
      >
        {labels.map((d, i) => (
          <span key={`${d}-${i}`}>{fmtDay(d, { year: yearLabels })}</span>
        ))}
      </div>
    </div>
  );
}

const SPARK_COLORS = { up: 'var(--green)', down: 'var(--red)', muted: 'var(--text-muted)' };

/** Navigator sparkline: same solid/dashed rule, no axis. */
export function Sparkline({
  points,
  tone,
}: {
  points: SeriesPoint[];
  tone: keyof typeof SPARK_COLORS;
}) {
  const geo = chartGeometry(points, { width: 96, height: 24, pad: 3 });
  if (!geo) return <span className="block h-6 w-16" />;
  const color = SPARK_COLORS[tone];
  return (
    <svg aria-hidden className="block h-6 w-16" preserveAspectRatio="none" viewBox="0 0 96 24">
      <path
        d={geo.solid}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={geo.dashed}
        fill="none"
        opacity={0.6}
        stroke={color}
        strokeDasharray="3 3"
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
