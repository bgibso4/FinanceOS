import { BalanceSource } from './codes';
import { isoDay, utcDay } from './dates';
import { roundCents } from './money';

export type ParsedLine =
  | { kind: 'ok'; text: string; date: string; balance: number }
  | { kind: 'unreadable'; text: string };
export type PastBalanceStatus =
  | { kind: 'new' }
  | { kind: 'replaces'; previous: number }
  | { kind: 'already' }
  | { kind: 'skipped'; source: BalanceSource; from: string }
  | { kind: 'future' }
  | { kind: 'repeated' }
  | { kind: 'unreadable' };
export type ClassifiedLine = { line: ParsedLine; status: PastBalanceStatus; saves: boolean };
export type ClassifyContext = {
  entered: { date: string; balance: number }[]; // existing `manual` rows, YYYY-MM-DD
  enterBefore: string | null; // YYYY-MM-DD; null = no cutoff (Manual)
  source: BalanceSource; // for the "Skipped: <source>" label
  today: string; // YYYY-MM-DD, server UTC day
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const US_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const LINE = /^(\S+?)[\t, ]+(.+)$/;

/** `YYYY-MM-DD` or `M/D/YYYY` to `YYYY-MM-DD`; null for anything else or an invalid calendar day. */
export function parseDayText(text: string): string | null {
  let iso: string;
  const us = US_DAY.exec(text);
  if (ISO_DAY.test(text)) iso = text;
  else if (us) iso = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  else return null;
  const d = utcDay(iso);
  return !Number.isNaN(d.getTime()) && isoDay(d) === iso ? iso : null;
}

/** Optional sign, then digits with commas only as 3-digit thousands groups, then decimals. */
const AMOUNT = /^(-?)\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;

/** A balance with optional currency symbol/code, thousands commas, `-`, `−` or `( )` negatives. */
export function parseBalanceText(text: string): number | null {
  let s = text.trim().replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  s = s
    .replace(/[A-Z]{2}\$/g, '')
    .replace(/\$/g, '')
    .replace(/\b[A-Z]{3}\b/g, '')
    .trim();
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const n = Number(`${m[1]}${m[2].replace(/,/g, '')}${m[3] ?? ''}`);
  const value = roundCents(negative ? -n : n);
  return value === 0 ? 0 : value; // no `-0`
}

export function parsePastBalances(text: string): ParsedLine[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((line): ParsedLine => {
      const m = LINE.exec(line);
      const date = m ? parseDayText(m[1]) : null;
      const balance = m ? parseBalanceText(m[2]) : null;
      return date !== null && balance !== null
        ? { kind: 'ok', text: line, date, balance }
        : { kind: 'unreadable', text: line };
    });
}

export function classifyPastBalances(lines: ParsedLine[], ctx: ClassifyContext): ClassifiedLine[] {
  const entered = new Map(ctx.entered.map((e) => [e.date, e.balance]));
  const seen = new Set<string>();
  return lines.map((line): ClassifiedLine => {
    const status = statusOf(line);
    return { line, status, saves: status.kind === 'new' || status.kind === 'replaces' };
  });

  function statusOf(line: ParsedLine): PastBalanceStatus {
    if (line.kind === 'unreadable') return { kind: 'unreadable' };
    const { date, balance } = line;
    if (date > ctx.today) return { kind: 'future' };
    if (ctx.enterBefore && date >= ctx.enterBefore) {
      return { kind: 'skipped', source: ctx.source, from: ctx.enterBefore };
    }
    if (seen.has(date)) return { kind: 'repeated' };
    seen.add(date);
    const previous = entered.get(date);
    if (previous === undefined) return { kind: 'new' };
    return roundCents(previous) === balance ? { kind: 'already' } : { kind: 'replaces', previous };
  }
}
