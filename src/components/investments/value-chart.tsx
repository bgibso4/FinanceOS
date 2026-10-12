'use client';

import type { SeriesPoint } from '@/lib/investments/history';
import { chartGeometry } from './chart-geometry';
import { fmtDay } from './format';

const WIDTH = 820;
const HEIGHT = 170;

/** Balance history: solid where recorded, dashed where estimated; dots on manual entries. */
export function ValueChart({
  points,
  manual = false,
}: {
  points: SeriesPoint[];
  manual?: boolean;
}) {
  const last = points.at(-1)?.value ?? 0;
  const geo = chartGeometry(points, {
    width: WIDTH,
    height: HEIGHT,
    pad: 8,
    yMin: manual ? last * 0.8 : undefined,
  });
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
  const labels = [points[0], points[Math.floor(lastIndex / 2)], points[lastIndex]];
  return (
    <div className="mt-3">
      <div className="relative h-[170px]">
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
          {[0.25, 0.5, 0.75].map((f) => (
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
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
        {labels.map((p, i) => (
          <span key={`${p.date}-${i}`}>{fmtDay(p.date)}</span>
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
