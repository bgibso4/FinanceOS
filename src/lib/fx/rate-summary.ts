import { addDays, isoDay } from '@/lib/investments/dates';
import type { MonthKey } from '@/lib/price-index/types';

const WEEKS = 52;
const MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RateSummary = {
  /** Newest stored rate and its day (YYYY-MM-DD). */
  rate: number;
  date: string;
  /** Rate on the latest stored day at or before a year before `date`; null with a shorter history. */
  yearAgoRate: number | null;
  /** Last rate in each 7-day bucket counted back from `date`, oldest first. */
  weekly: { day: string; rate: number }[];
  /** Last rate of each calendar month, newest first. */
  monthEnds: { month: MonthKey; rate: number }[];
};

export type ExchangeRatesResponse = {
  rates: ({ fromCurrency: string; toCurrency: string; updatedAt: string } & RateSummary)[];
};

/** Sparkline points, one-year change and month-end table for ONE currency pair (rows in any order). */
export function summarizePair(rows: { date: Date; rate: number }[]): RateSummary {
  const days = rows
    .map((r) => ({ day: isoDay(r.date), rate: r.rate }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const newest = days[days.length - 1];

  const yearAgo = isoDay(addDays(new Date(`${newest.day}T00:00:00Z`), -365));
  const yearAgoRate = days.findLast((d) => d.day <= yearAgo)?.rate ?? null;

  const newestMs = Date.parse(`${newest.day}T00:00:00Z`);
  const bucketOf = (day: string) =>
    Math.floor((newestMs - Date.parse(`${day}T00:00:00Z`)) / DAY_MS / 7);
  const weeks = new Map<number, { day: string; rate: number }>();
  for (const d of days) weeks.set(bucketOf(d.day), d); // ascending, so the last in a bucket wins
  const weekly = [...weeks]
    .filter(([bucket]) => bucket < WEEKS)
    .sort(([a], [b]) => b - a)
    .map(([, d]) => d);

  const months = new Map<MonthKey, number>();
  for (const d of days) months.set(d.day.slice(0, 7), d.rate);
  const monthEnds = [...months]
    .map(([month, rate]) => ({ month, rate }))
    .reverse()
    .slice(0, MONTHS);

  return { rate: newest.rate, date: newest.day, yearAgoRate, weekly, monthEnds };
}
