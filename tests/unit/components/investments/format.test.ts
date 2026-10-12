import { describe, it, expect } from 'vitest';
import {
  changeText,
  daysBetween,
  fmtCompact,
  fmtDay,
  fmtMoney,
  fmtPct,
  fmtQty,
  fmtSignedMoney,
  fmtSyncTime,
  signedTone,
  toneOf,
} from '@/components/investments/format';
import { institutionMark } from '@/components/investments/institution-mark';
import { PIE_COLORS } from '@/components/chart-renderer';

describe('investment formatting', () => {
  it('formats money with a true minus and native prefixes', () => {
    expect(fmtMoney(1234.4)).toBe('$1,234');
    expect(fmtMoney(-5)).toBe('−$5');
    expect(fmtMoney(-0.4)).toBe('$0');
    expect(fmtMoney(12.5, { cents: true })).toBe('$12.50');
    expect(fmtMoney(1000, { currency: 'CAD' })).toBe('CA$1,000');
    expect(fmtSignedMoney(5)).toBe('+$5');
    expect(fmtSignedMoney(-5)).toBe('−$5');
    expect(fmtSignedMoney(5, { currency: 'CAD' })).toBe('+CA$5');
  });

  it('compacts large values', () => {
    expect(fmtCompact(950)).toBe('$950');
    expect(fmtCompact(12_345)).toBe('$12.3k');
    expect(fmtCompact(123_456)).toBe('$123k');
    expect(fmtCompact(12_345, 'CAD')).toBe('CA$12.3k');
    expect(fmtCompact(-950, 'CAD')).toBe('−CA$950');
  });

  it('formats percentages, quantities and dates', () => {
    expect(fmtPct(1.234)).toBe('+1.2%');
    expect(fmtPct(-3)).toBe('−3.0%');
    expect(fmtPct(0)).toBe('+0.0%');
    expect(fmtPct(-0.04)).toBe('+0.0%');
    expect(fmtQty(1234.56789)).toBe('1,234.5679');
    expect(fmtDay('2026-10-09')).toBe('Oct 9');
    expect(fmtSyncTime('2026-10-09T13:24:00Z')).toMatch(/^Oct \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
    expect(daysBetween('2026-07-12', '2026-10-09')).toBe(89);
  });

  it('describes a change with an arrow outside the deadband', () => {
    expect(toneOf(0.04)).toBe('flat');
    expect(toneOf(null)).toBe('flat');
    expect(signedTone(null)).toBe('text-[var(--text-muted)]');
    expect(signedTone(0)).toBe('text-[var(--green)]');
    expect(signedTone(-1)).toBe('text-[var(--red)]');
    expect(changeText({ start: 100, end: 110, delta: 10, pct: 10 })).toBe('↗ $10 · +10.0%');
    expect(changeText({ start: 100, end: 90, delta: -10, pct: -10 })).toBe('↘ −$10 · −10.0%');
    expect(changeText({ start: 0, end: 5, delta: 5, pct: null })).toBe('$5');
    expect(changeText({ start: 0, end: 5, delta: 5, pct: null }, 'CAD')).toBe('CA$5');
  });

  it('marks institutions with initials and a stable palette colour', () => {
    expect(PIE_COLORS).toContain(institutionMark('Test Brokerage').color);
    expect(institutionMark('Test Brokerage').initials).toBe('TB');
    expect(institutionMark('acme').initials).toBe('A');
    expect(institutionMark('').initials).toBe('?');
  });
});
