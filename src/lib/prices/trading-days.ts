import { addDays, utcDay } from '@/lib/investments/dates';

// 16:00 ET is 20:00 UTC (EDT) or 21:00 UTC (EST); 21:30 covers both plus time for Yahoo to publish.
const SETTLED_UTC_MINUTES = 21 * 60 + 30;

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/**
 * The latest UTC day whose daily close is final. Exchange holidays are not modelled: asking for a
 * holiday returns no bar, nothing is stored, and the next run asks again (one cheap call).
 */
export function lastCompletedTradingDay(now: Date, market: 'exchange' | 'crypto'): Date {
  const today = utcDay(now);
  if (market === 'crypto') return addDays(today, -1);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (!isWeekend(today) && minutes >= SETTLED_UTC_MINUTES) return today;
  let d = addDays(today, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}
