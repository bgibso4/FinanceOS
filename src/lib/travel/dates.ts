import { daysBetween } from '@/lib/dates';
import { isoDay } from '@/lib/investments/dates';
import type { TripRecord } from './types';

const DAY_MS = 86_400_000;

/** Midnight UTC at the start of a `YYYY-MM-DD` day. */
export const dayStart = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** The last millisecond (UTC) of a `YYYY-MM-DD` day. */
export const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999Z`);

/** Days in a trip, both ends included. */
export const tripDays = (t: TripRecord): number => daysBetween(t.startDate, t.endDate) + 1;

export const TRIP_DATES_ERROR = "Return can't be before Leave.";

/** A trip may start and end on one day, never end first. */
export const tripDatesInOrder = (t: { startDate: string; endDate: string }): boolean =>
  t.endDate >= t.startDate;

export function addDays(iso: string, n: number): string {
  return isoDay(new Date(dayStart(iso).getTime() + n * DAY_MS));
}
