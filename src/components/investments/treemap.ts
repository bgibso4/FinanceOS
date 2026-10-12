export type Tile = { key: string; x: number; y: number; w: number; h: number };

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Squarified treemap (Bruls et al.): tiles with areas proportional to value, largest first. */
export function squarify(
  items: { key: string; value: number }[],
  width: number,
  height: number
): Tile[] {
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((sum, i) => sum + i.value, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const queue = positive
    .sort((a, b) => b.value - a.value)
    .map((i) => ({ key: i.key, area: i.value * scale }));

  const tiles: Tile[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  while (queue.length) {
    const side = Math.min(w, h);
    const row = [queue.shift()!];
    while (
      queue.length &&
      worst(
        [...row, queue[0]].map((t) => t.area),
        side
      ) <=
        worst(
          row.map((t) => t.area),
          side
        )
    ) {
      row.push(queue.shift()!);
    }
    const rowArea = row.reduce((sum, t) => sum + t.area, 0);
    if (w >= h) {
      const colW = rowArea / h;
      let cy = y;
      for (const t of row) {
        tiles.push({ key: t.key, x, y: cy, w: colW, h: t.area / colW });
        cy += t.area / colW;
      }
      x += colW;
      w -= colW;
    } else {
      const rowH = rowArea / w;
      let cx = x;
      for (const t of row) {
        tiles.push({ key: t.key, x: cx, y, w: t.area / rowH, h: rowH });
        cx += t.area / rowH;
      }
      y += rowH;
      h -= rowH;
    }
  }
  return tiles;
}

/** Muted diverging tint by range price change: 14% at no change up to 60% at ±12% or more. */
export function tileBackground(changePct: number | null): string {
  if (changePct == null) return 'var(--bg-elevated)';
  const strength = Math.round(14 + Math.min(Math.abs(changePct) / 12, 1) * 46);
  const base = changePct >= 0 ? 'var(--green)' : 'var(--red)';
  return `color-mix(in srgb, ${base} ${strength}%, var(--bg-card))`;
}
