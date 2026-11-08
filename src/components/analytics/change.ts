import { MINUS, fmtMoney } from '@/lib/currency';

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? MINUS : '');

/** "+$50" / "−$30" and "+50%" / "−25%"; with nothing to compare against the percent is "—" (P9). */
export function changeText(now: number, then: number): { amount: string; percent: string } {
  const diff = Math.round(now - then);
  const pct = then === 0 ? null : Math.round(((now - then) / Math.abs(then)) * 100);
  return {
    amount: `${sign(diff)}${fmtMoney(Math.abs(diff))}`,
    percent: pct === null ? '—' : `${sign(pct)}${Math.abs(pct)}%`,
  };
}
