import type { TripRecord } from './types';

const DAY_MS = 86_400_000;

/** Midnight UTC at the start of a `YYYY-MM-DD` day. */
export const dayStart = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The last millisecond (UTC) of a `YYYY-MM-DD` day. */
export const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999Z`);

/** Whole days from one `YYYY-MM-DD` day to another (negative when `b` is earlier). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY_MS);

/** Days in a trip, both ends included. */
export const tripDays = (t: TripRecord): number => daysBetween(t.startDate, t.endDate) + 1;

/** A trip belongs to the year it starts in. */
export const tripYear = (t: TripRecord): number => Number(t.startDate.slice(0, 4));

export function addDays(iso: string, n: number): string {
  return new Date(dayStart(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}
