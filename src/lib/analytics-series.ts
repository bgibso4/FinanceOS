import type { Category } from '@/components/transactions/types';
import type { DaySpend } from './analytics';
import { isDaily, shiftMonths, type DayRange } from './analytics-period';
import { PIE_COLORS } from './chart-colors';
import { UNCATEGORIZED } from './transaction-filters';
import { addDays, isoDay, utcDay } from './investments/dates';

export type Pick = { key: string; label: string; categoryIds: (string | null)[] };
export type ChartLine = { key: string; label: string; color: string; dashed: boolean };
export type ChartPoint = { x: string; values: Record<string, number | null> };

const CURRENT = 'current';
const COMPARE = 'compare';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Group id for a category: its parent, or itself when top level. */
const groupOf = (id: string, byId: Map<string, Category>) => byId.get(id)?.parentId ?? id;

/** A fully ticked group is one pick; otherwise each ticked category is its own. */
export function picksFor(selected: string[], categories: Category[]): Pick[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  }
  const ticked = new Set(selected);
  const done = new Set<string>();
  const picks: Pick[] = [];
  for (const id of selected) {
    if (id === UNCATEGORIZED) {
      picks.push({ key: id, label: 'Uncategorized', categoryIds: [null] });
      continue;
    }
    const cat = byId.get(id);
    if (!cat) continue;
    const group = cat.parentId ? byId.get(cat.parentId) : children.has(cat.id) ? cat : undefined;
    const siblings = group ? children.get(group.id)! : [];
    if (group && siblings.every((c) => ticked.has(c.id))) {
      if (done.has(group.id)) continue;
      done.add(group.id);
      // The group's own id is included: rows can be booked directly on the group.
      picks.push({
        key: group.id,
        label: group.name,
        categoryIds: [group.id, ...siblings.map((c) => c.id)],
      });
    } else if (cat.id !== group?.id) {
      picks.push({ key: cat.id, label: cat.name, categoryIds: [cat.id] });
    }
  }
  return picks;
}

/** PIE_COLORS in order for keys already ranked by spend, biggest first. */
export function assignColors(keysBySpend: string[]): Record<string, string> {
  return Object.fromEntries(keysBySpend.map((k, i) => [k, PIE_COLORS[i % PIE_COLORS.length]]));
}

/** Each pick with its rows and spend, biggest first: the order its line and ring slice share (M7). */
export function rankPicks(
  picks: Pick[],
  rows: DaySpend[]
): { pick: Pick; rows: DaySpend[]; total: number }[] {
  return picks
    .map((pick) => {
      const own = rows.filter((r) => pick.categoryIds.includes(r.categoryId));
      return { pick, rows: own, total: sum(own.map((r) => r.amount)) };
    })
    .sort((a, b) => b.total - a.total);
}

/** Spend per group id (a top-level category counts as its own group), plus UNCATEGORIZED. */
export function groupTotals(rows: DaySpend[], categories: Category[]): Record<string, number> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const key = r.categoryId === null ? UNCATEGORIZED : groupOf(r.categoryId, byId);
    totals[key] = (totals[key] ?? 0) + r.amount;
  }
  return totals;
}

const rangeKeys = (r: DayRange, daily: boolean): string[] => {
  const keys: string[] = [];
  if (daily) {
    for (let d = utcDay(r.start); isoDay(d) <= r.end; d = addDays(d, 1)) keys.push(isoDay(d));
  } else {
    for (
      let m = r.start.slice(0, 7);
      m <= r.end.slice(0, 7);
      m = shiftMonths(`${m}-01`, 1).slice(0, 7)
    )
      keys.push(m);
  }
  return keys;
};

/** The axis key `n` steps on from the first key (days or months). */
const extend = (keys: string[], n: number, daily: boolean): string[] => {
  const out = [...keys];
  while (out.length < n) {
    const last = out[out.length - 1];
    out.push(daily ? isoDay(addDays(utcDay(last), 1)) : shiftMonths(`${last}-01`, 1).slice(0, 7));
  }
  return out;
};

export function buildSeries(i: {
  current: DaySpend[];
  compare: DaySpend[] | null;
  shown: DayRange;
  through: string;
  compareRange: DayRange | null;
  running: boolean;
  categoryIds: (string | null)[] | null;
  picks?: Pick[];
  labels: { current: string; compare: string };
}): { points: ChartPoint[]; lines: ChartLine[]; todayIndex: number | null } {
  const daily = isDaily(i.shown);
  const bucket = (date: string) => (daily ? date : date.slice(0, 7));
  const cumulative = daily || i.running;
  const allowed = i.categoryIds && new Set(i.categoryIds);
  const keep = (r: DaySpend) => !allowed || allowed.has(r.categoryId);

  const shownKeys = rangeKeys(i.shown, daily);
  const comparing = i.compare && i.compareRange && !i.picks?.length;
  const compareKeys = comparing ? rangeKeys(i.compareRange!, daily) : [];
  const n = Math.max(shownKeys.length, compareKeys.length);
  const axis = extend(shownKeys, n, daily);
  const cutoff = bucket(i.through);

  /** Spend per axis slot; `cut` blanks slots after `through`. */
  const series = (rows: DaySpend[], keys: string[], cut: boolean): (number | null)[] => {
    const per = new Map<string, number>();
    for (const r of rows) per.set(bucket(r.date), (per.get(bucket(r.date)) ?? 0) + r.amount);
    let acc = 0;
    return Array.from({ length: n }, (_, k) => {
      const key = keys[k];
      if (key === undefined || (cut && key > cutoff)) return null;
      const v = per.get(key) ?? 0;
      acc = cumulative ? acc + v : v;
      return acc;
    });
  };

  const columns: { line: ChartLine; values: (number | null)[] }[] = [];
  const rows = i.current.filter(keep);
  if (i.picks?.length) {
    const ranked = rankPicks(i.picks, rows);
    const colors = assignColors(ranked.map((e) => e.pick.key));
    for (const e of ranked) {
      columns.push({
        line: { key: e.pick.key, label: e.pick.label, color: colors[e.pick.key], dashed: false },
        values: series(e.rows, axis, true),
      });
    }
  } else {
    columns.push({
      line: { key: CURRENT, label: i.labels.current, color: 'var(--accent)', dashed: false },
      values: series(rows, axis, true),
    });
    if (comparing) {
      columns.push({
        line: { key: COMPARE, label: i.labels.compare, color: 'var(--text-muted)', dashed: true },
        values: series(i.compare!.filter(keep), compareKeys, false),
      });
    }
  }

  const points = axis.map((x, k) => ({
    x,
    values: Object.fromEntries(columns.map((c) => [c.line.key, c.values[k]])),
  }));
  const todayIndex = daily && i.through < i.shown.end ? axis.indexOf(i.through) : null;
  return {
    points,
    lines: columns.map((c) => c.line),
    todayIndex: todayIndex !== null && todayIndex >= 0 ? todayIndex : null,
  };
}

/** Running-total readout (expects cumulative series, i.e. the daily view or running on): the current line's last value against the comparison on the same day and at its end. */
export function soFar(
  points: ChartPoint[],
  lines: ChartLine[]
): { now: number; thenSameDay: number; thenTotal: number } | null {
  if (!lines.some((l) => l.key === CURRENT) || !lines.some((l) => l.key === COMPARE)) return null;
  let last = -1;
  points.forEach((p, k) => {
    if (p.values[CURRENT] !== null) last = k;
  });
  if (last < 0) return null;
  const then = points.map((p) => p.values[COMPARE]).filter((v): v is number => v !== null);
  return {
    now: points[last].values[CURRENT]!,
    thenSameDay: points[last].values[COMPARE] ?? 0,
    thenTotal: then[then.length - 1] ?? 0,
  };
}
