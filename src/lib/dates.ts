import { utcDay } from './investments/dates';

/**
 * Three kinds of date:
 * - Calendar days: transactions and the like, with no time of day, stored at UTC midnight.
 *   Show them as stored, with `fmtCalendarDay`; converting to local moves them a day.
 * - Moments: e.g. last synced. Stored in UTC, shown in local time.
 * - Today: the user's own date, `localDay`. The server runs on the user's machine, so its zone
 *   is theirs. `new Date().toISOString()` is the UTC date, a day ahead late in the evening.
 */

/** `YYYY-MM-DD` on the user's own clock. */
export function localDay(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Today as a stored calendar day. */
export const storedToday = (now: Date = new Date()): Date => utcDay(localDay(now));

/** Formats a calendar day (`YYYY-MM-DD`, or a stored date) as it is, with no time-zone shift. */
export const fmtCalendarDay = (iso: string, opts: Intl.DateTimeFormatOptions = {}): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    ...opts,
    timeZone: 'UTC',
  });

/** For dates that may be either kind: UTC midnight is a calendar day, anything else a moment. */
export const fmtStoredDate = (iso: string, opts: Intl.DateTimeFormatOptions = {}): string =>
  iso.slice(10) === 'T00:00:00.000Z'
    ? fmtCalendarDay(iso, opts)
    : new Date(iso).toLocaleDateString('en-US', opts);

/** The stored span of a month. `monthIndex` is 0-based and may run past either end of the year. */
export const utcMonthRange = (year: number, monthIndex: number): { start: Date; end: Date } => ({
  start: new Date(Date.UTC(year, monthIndex, 1)),
  end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)),
});
