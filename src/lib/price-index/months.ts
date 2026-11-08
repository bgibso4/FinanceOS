import type { MonthKey } from './types';

/** The UTC calendar month a moment falls in. */
export function monthOf(d: Date): MonthKey {
  return d.toISOString().slice(0, 7);
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const total = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + n;
  const year = Math.floor(total / 12);
  return `${String(year).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** `Sep 2026` or `September 2026`. */
export function fmtMonth(m: MonthKey, style: 'short' | 'long'): string {
  return new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: style,
    year: 'numeric',
    timeZone: 'UTC',
  });
}
