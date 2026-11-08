import { daysBetween, fmtCalendarDay } from './dates';
import { addDays, isoDay, utcDay } from './investments/dates';

export type PeriodKind = 'month' | '3m' | 'year' | 'custom';
export type CompareKind = 'prev' | 'lastYear' | 'none';
/** Inclusive calendar days, `YYYY-MM-DD`. */
export type DayRange = { start: string; end: string };
/** `anchor` is `YYYY-MM`, the last month of the period (December for a year). */
export type Period = { kind: PeriodKind; anchor: string; custom?: DayRange };

export const KIND_LABELS: Record<PeriodKind, string> = {
  month: 'Month',
  '3m': '3 months',
  year: 'Year',
  custom: 'Custom',
};
export const COMPARE_LABELS: Record<CompareKind, string> = {
  prev: 'The period before',
  lastYear: 'Same time last year',
  none: 'Nothing',
};
/** Short wording for the "vs" chip and the comparison figure. */
export const COMPARE_SHORT: Record<CompareKind, string> = {
  prev: 'Period before',
  lastYear: 'Last year',
  none: 'Nothing',
};

const MONTHS: Record<Exclude<PeriodKind, 'custom'>, number> = { month: 1, '3m': 3, year: 12 };

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(daysInMonth(y, m))}`;
};
/** Days in a range, both ends counted. */
export const dayCount = (r: DayRange) => daysBetween(r.start, r.end) + 1;

/** Moves a day by whole months, clamping the day (Mar 31 - 1 month = Feb 28). */
export function shiftMonths(day: string, k: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + k;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

const shiftAnchor = (anchor: string, k: number) => shiftMonths(`${anchor}-01`, k).slice(0, 7);

/** Months in a period, and so how far "the period before" steps back: 1, 3 or 12. */
const stepMonths = (p: Period) => MONTHS[p.kind as keyof typeof MONTHS] ?? 1;

export function fullRange(p: Period): DayRange {
  if (p.kind === 'custom' && p.custom) return p.custom;
  return { start: `${shiftAnchor(p.anchor, 1 - stepMonths(p))}-01`, end: lastDayOf(p.anchor) };
}

/** The period's days up to today; `partial` when that cut it short. */
export function periodRange(p: Period, today: string): DayRange & { partial: boolean } {
  const full = fullRange(p);
  return full.end > today
    ? { start: full.start, end: today, partial: true }
    : { ...full, partial: false };
}

const shiftPeriod = (p: Period, k: number): Period => ({ ...p, anchor: shiftAnchor(p.anchor, k) });

function compareShift(p: Period, vs: CompareKind): number {
  return vs === 'lastYear' ? -12 : -stepMonths(p);
}

/** The range the figures compare against (spec section 3), or null for none. */
export function compareRange(p: Period, vs: CompareKind, today: string): DayRange | null {
  if (vs === 'none') return null;
  const r = periodRange(p, today);
  if (p.kind === 'custom') {
    if (vs === 'lastYear')
      return { start: shiftMonths(r.start, -12), end: shiftMonths(r.end, -12) };
    const n = dayCount(r);
    return {
      start: isoDay(addDays(utcDay(r.start), -n)),
      end: isoDay(addDays(utcDay(r.start), -1)),
    };
  }
  const k = compareShift(p, vs);
  if (!r.partial) return fullRange(shiftPeriod(p, k));
  return { start: shiftMonths(r.start, k), end: shiftMonths(r.end, k) };
}

/** As `compareRange`, but a partial period's comparison runs to the end of its month, for the chart. */
export function compareChartRange(p: Period, vs: CompareKind, today: string): DayRange | null {
  if (vs === 'none') return null;
  if (p.kind !== 'custom' && periodRange(p, today).partial) {
    return fullRange(shiftPeriod(p, compareShift(p, vs)));
  }
  return compareRange(p, vs, today);
}

/** One step back or on. A custom range keeps its length; a step on that would pass today ends today. */
export function stepPeriod(p: Period, delta: 1 | -1, today: string): Period {
  if (p.kind === 'custom' && p.custom) {
    const length = dayCount(p.custom);
    const shifted = isoDay(addDays(utcDay(p.custom.end), delta * length));
    const end = shifted > today ? today : shifted;
    const start = isoDay(addDays(utcDay(end), 1 - length));
    return { ...p, anchor: end.slice(0, 7), custom: { start, end } };
  }
  return shiftPeriod(p, delta * stepMonths(p));
}

export function switchKind(p: Period, kind: PeriodKind, today: string): Period {
  if (kind === p.kind) return p;
  const last = p.custom && p.kind === 'custom' ? p.custom.end.slice(0, 7) : p.anchor;
  if (kind === 'custom') {
    const { start, end } = periodRange(p, today);
    return { kind, anchor: last, custom: { start, end } };
  }
  if (kind === 'year') return { kind, anchor: `${last.slice(0, 4)}-12` };
  const thisMonth = today.slice(0, 7);
  return { kind, anchor: last > thisMonth ? thisMonth : last };
}

export function isLatest(p: Period, today: string): boolean {
  return fullRange(p).end >= today;
}

/** True when the range starts on a 1st and ends on a month's last day. */
export const wholeMonths = (r: DayRange): boolean =>
  r.start.endsWith('-01') && r.end === lastDayOf(r.end.slice(0, 7));

/** True when the range sits inside one calendar month, so the chart shows days. */
export const isDaily = (r: DayRange): boolean => r.start.slice(0, 7) === r.end.slice(0, 7);

const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => fmtCalendarDay(day, opts);
const MONTH_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };
const FULL_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

/** "Jun 1 – Oct 31, 2026", or with both years when the range crosses one. */
function dayRangeText(r: DayRange): string {
  return r.start.slice(0, 4) === r.end.slice(0, 4)
    ? `${fmt(r.start, MONTH_DAY)} – ${fmt(r.end, FULL_DATE)}`
    : `${fmt(r.start, FULL_DATE)} – ${fmt(r.end, FULL_DATE)}`;
}

export function periodLabel(p: Period): string {
  const r = fullRange(p);
  switch (p.kind) {
    case 'month':
      return fmt(r.end, { month: 'long', year: 'numeric' });
    case 'year':
      return r.end.slice(0, 4);
    case '3m':
      return r.start.slice(0, 4) === r.end.slice(0, 4)
        ? `${fmt(r.start, { month: 'short' })} – ${fmt(r.end, MONTH_YEAR)}`
        : `${fmt(r.start, MONTH_YEAR)} – ${fmt(r.end, MONTH_YEAR)}`;
    default:
      return dayRangeText(r);
  }
}

/** Heading for a figures column: names exactly what it covers. */
export function columnLabel(r: DayRange & { partial?: boolean }, p: Period): string {
  const wholeMonth = wholeMonths(r);
  if (r.partial && p.kind === 'month') return `${fmt(r.start, MONTH_YEAR)} so far`;
  if (wholeMonth && r.start.slice(0, 7) === r.end.slice(0, 7)) return fmt(r.start, MONTH_YEAR);
  if (wholeMonth && r.start.endsWith('-01-01') && r.end.endsWith('-12-31'))
    return r.end.slice(0, 4);
  if (isDaily(r)) {
    const sameYear = r.end.slice(0, 4) === fullRange(p).end.slice(0, 4);
    return `${fmt(r.start, MONTH_DAY)} – ${fmt(r.end, sameYear ? MONTH_DAY : FULL_DATE)}`;
  }
  return dayRangeText(r);
}
