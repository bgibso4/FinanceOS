import { getCurrencySymbol } from '@/lib/currency';
import type { SeriesChange } from '@/lib/investments/portfolio-view';

export const MINUS = '−';
const DAY_MS = 86_400_000;
const DEADBAND_PCT = 0.05;

const symbolFor = (currency = 'USD') => (currency === 'CAD' ? 'CA$' : getCurrencySymbol(currency));

export type MoneyOpts = { cents?: boolean; currency?: string };

/** `$1,234`, `CA$1,234`, `−$5` (U+2212). Whole units unless `cents`. */
export function fmtMoney(v: number, opts: MoneyOpts = {}): string {
  const digits = opts.cents ? 2 : 0;
  const rounded = Number(v.toFixed(digits));
  const body = Math.abs(rounded).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${rounded < 0 ? MINUS : ''}${symbolFor(opts.currency)}${body}`;
}

export const fmtSignedMoney = (v: number, opts: MoneyOpts = {}): string =>
  Number(v.toFixed(opts.cents ? 2 : 0)) > 0 ? `+${fmtMoney(v, opts)}` : fmtMoney(v, opts);

/** Treemap values: `$12.3k`, `$123k` from 100k, plain units under 1k. */
export function fmtCompact(v: number, currency?: string): string {
  if (Math.abs(v) < 1000) return fmtMoney(v, { currency });
  const k = v / 1000;
  return `${v < 0 ? MINUS : ''}${symbolFor(currency)}${Math.abs(k).toFixed(Math.abs(v) >= 100_000 ? 0 : 1)}k`;
}

/** `+1.2%`, `−3.0%`; the sign follows the rounded value, so `−0.04` reads `+0.0%`. */
export function fmtPct(p: number): string {
  const rounded = Number(p.toFixed(1));
  return `${rounded < 0 ? MINUS : '+'}${Math.abs(rounded).toFixed(1)}%`;
}

export const fmtQty = (q: number): string =>
  q.toLocaleString('en-US', { maximumFractionDigits: 4 });

/** `Oct 9` for a `YYYY-MM-DD` day. */
export const fmtDay = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** `Oct 9, 9:24 AM` in local time, for sync timestamps. */
export const fmtSyncTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round(
    (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  );

export type Tone = 'up' | 'down' | 'flat';

export function toneOf(pct: number | null): Tone {
  if (pct == null || Math.abs(pct) <= DEADBAND_PCT) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

const ARROWS: Record<Tone, string> = { up: '↗ ', down: '↘ ', flat: '' };

/** Text colour for a signed figure (gain, price change): muted when unknown. */
export const signedTone = (v: number | null): string =>
  v == null ? 'text-[var(--text-muted)]' : v >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]';

/** `↗ $1,234 · +2.1%` — a balance change, never labelled a return. */
export function changeText(change: SeriesChange, currency?: string): string {
  const money = `${ARROWS[toneOf(change.pct)]}${fmtMoney(change.delta, { currency })}`;
  return change.pct == null ? money : `${money} · ${fmtPct(change.pct)}`;
}
