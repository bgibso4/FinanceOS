import type { TripRecord } from './types';

const DAY_MS = 86_400_000;

/** Midnight UTC at the start of a `YYYY-MM-DD` day. */
export const dayStart = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The last millisecond (UTC) of a `YYYY-MM-DD` day. */
export const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999Z`);

/** Days in a trip, both ends included. */
export const tripDays = (t: TripRecord): number =>
  Math.round((dayStart(t.endDate).getTime() - dayStart(t.startDate).getTime()) / DAY_MS) + 1;

/** A trip belongs to the year it starts in. */
export const tripYear = (t: TripRecord): number => Number(t.startDate.slice(0, 4));

export function addDays(iso: string, n: number): string {
  return new Date(dayStart(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}
