import { describe, expect, it } from 'vitest';
import { addMonths, fmtMonth, monthOf } from '@/lib/price-index/months';

describe('months', () => {
  it('addMonths crosses year boundaries both ways', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-09', -12)).toBe('2025-09');
  });

  it('monthOf uses the UTC calendar month', () => {
    expect(monthOf(new Date('2026-03-31T23:30:00Z'))).toBe('2026-03');
  });

  it('fmtMonth formats short and long', () => {
    expect(fmtMonth('2026-09', 'long')).toBe('September 2026');
    expect(fmtMonth('2026-09', 'short')).toBe('Sep 2026');
  });
});
