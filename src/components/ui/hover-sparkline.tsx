'use client';

import { useState } from 'react';
import { chartGeometry, nearestIndex } from '@/components/investments/chart-geometry';

type Point = { label: string; value: number };

const VIEW_WIDTH = 100;
const PAD = 3;

/**
 * A width-filling sparkline. Hovering reads the nearest point as "{label} · {value}" with a
 * guide line, dot and tooltip. Dots are HTML so they stay round under the stretched viewBox.
 */
export function HoverSparkline({
  points,
  format,
  label,
  height = 26,
}: {
  points: Point[];
  format: (v: number) => string;
  label: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const geo = chartGeometry(
    points.map((p) => ({ value: p.value, isEstimated: false })),
    { width: VIEW_WIDTH, height, pad: PAD }
  );
  if (!geo) return <div aria-label={label} role="img" style={{ height }} />;

  const last = geo.points.length - 1;
  const shown = hover ?? last;
  const dot = geo.points[shown];
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    setHover(nearestIndex((e.clientX - rect.left) / rect.width, points.length));
  };

  return (
    <div
      aria-label={label}
      className="relative cursor-crosshair"
      role="img"
      style={{ height }}
      onPointerLeave={() => setHover(null)}
      onPointerMove={onMove}
    >
      <svg
        aria-hidden
        className="absolute inset-0 block h-full w-full overflow-visible"
        preserveAspectRatio="none"
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      >
        <path d={geo.area} fill="var(--accent)" opacity={0.08} />
        <path
          d={geo.solid}
          fill="none"
          stroke="var(--accent)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && (
          <line
            stroke="var(--border-hover)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            x1={dot.x}
            x2={dot.x}
            y1={0}
            y2={height}
          />
        )}
      </svg>
      <span
        className="pointer-events-none absolute rounded-full bg-[var(--accent)]"
        style={{
          left: `${dot.x}%`,
          top: dot.y,
          width: hover === null ? 5 : 6,
          height: hover === null ? 5 : 6,
          transform: 'translate(-50%, -50%)',
        }}
      />
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[6px] bg-[var(--text-primary)] px-[7px] py-[3px] text-[11px] text-[var(--bg-card)]"
          style={{ left: `${dot.x}%`, bottom: 'calc(100% + 6px)', transform: 'translateX(-50%)' }}
        >
          {points[hover].label} · {format(points[hover].value)}
        </div>
      )}
    </div>
  );
}
