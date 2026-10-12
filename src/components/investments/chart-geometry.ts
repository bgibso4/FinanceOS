export type ChartBox = { width: number; height: number; pad: number; yMin?: number };
export type ChartGeometry = {
  solid: string;
  dashed: string;
  area: string;
  points: { x: number; y: number }[];
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
    x: r((i / (points.length - 1)) * box.width),
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
  return { solid, dashed, area: `${line}L${box.width},${box.height}L0,${box.height}Z`, points: xy };
}
