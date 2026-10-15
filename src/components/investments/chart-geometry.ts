/** `lead`: days of the range before the first point, left empty at the chart's start. */
export type ChartBox = { width: number; height: number; pad: number; yMin?: number; lead?: number };
export type ChartGeometry = {
  solid: string;
  dashed: string;
  area: string;
  points: { x: number; y: number }[];
  /** Value at the plot's floor, and the value range the plot height covers. */
  min: number;
  span: number;
};

const r = (n: number) => Number(n.toFixed(2));

/**
 * SVG paths for a value series in a `width × height` box. Each segment is drawn solid when both
 * ends are recorded values, dashed when either is estimated. `yMin` lowers the floor (manual
 * accounts, so a flat carry-forward doesn't hug the baseline). A flat series sits on the floor.
 */
export function chartGeometry(
  points: { value: number; isEstimated: boolean }[],
  box: ChartBox
): ChartGeometry | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values, box.yMin ?? Infinity);
  const span = max - min || 1;
  const xy = points.map((p, i) => ({
    x: r((((box.lead ?? 0) + i) / ((box.lead ?? 0) + points.length - 1)) * box.width),
    y: r(box.pad + (1 - (p.value - min) / span) * (box.height - 2 * box.pad)),
  }));
  let solid = '';
  let dashed = '';
  for (let i = 1; i < xy.length; i++) {
    const seg = `M${xy[i - 1].x},${xy[i - 1].y}L${xy[i].x},${xy[i].y}`;
    if (points[i].isEstimated || points[i - 1].isEstimated) dashed += seg;
    else solid += seg;
  }
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
  return {
    solid,
    dashed,
    area: `${line}L${box.width},${box.height}L${xy[0].x},${box.height}Z`,
    points: xy,
    min,
    span,
  };
}

/** Horizontal gridlines, as fractions of the plot height from the top. */
export const GRIDLINES = [0.25, 0.5, 0.75] as const;

/** The value at each gridline, top to bottom: `chartGeometry`'s y mapping inverted. */
export function gridValues(geo: ChartGeometry, box: ChartBox): number[] {
  return GRIDLINES.map(
    (f) => geo.min + (1 - (box.height * f - box.pad) / (box.height - 2 * box.pad)) * geo.span
  );
}

/** Index of the point nearest a pointer at `fraction` (0–1) of the width; null over the lead. */
export function nearestIndex(fraction: number, count: number, lead = 0): number | null {
  if (count < 1) return null;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const i = Math.round(clamped * (lead + count - 1)) - lead;
  return i < 0 ? null : Math.min(i, count - 1);
}

/** The tooltip sits right of the crosshair, or left once past `flipAt` of the width. */
export const tooltipSide = (fraction: number, flipAt = 0.72): 'left' | 'right' =>
  fraction > flipAt ? 'left' : 'right';
