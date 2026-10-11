const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight for a `YYYY-MM-DD` string or the UTC day of a Date. */
export function utcDay(input: string | Date): Date {
  if (typeof input === 'string') return new Date(`${input.slice(0, 10)}T00:00:00.000Z`);
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
