import { describe, it, expect } from 'vitest';
import { lastCompletedTradingDay, previousTradingDay, marketOf } from '@/lib/prices/trading-days';
import { isoDay, utcDay } from '@/lib/investments/dates';

const at = (iso: string, market: 'exchange' | 'crypto' = 'exchange') =>
  isoDay(lastCompletedTradingDay(new Date(iso), market));

describe('lastCompletedTradingDay', () => {
  it('is today once the US close has settled on a weekday', () => {
    expect(at('2026-10-09T22:00:00Z')).toBe('2026-10-09'); // Friday
  });
  it('is the previous weekday before the close', () => {
    expect(at('2026-10-09T15:00:00Z')).toBe('2026-10-08');
  });
  it('is Friday on a weekend', () => {
    expect(at('2026-10-10T12:00:00Z')).toBe('2026-10-09');
  });
  it('is Friday on Monday morning', () => {
    expect(at('2026-10-12T10:00:00Z')).toBe('2026-10-09');
  });
  it('is yesterday (UTC) for crypto', () => {
    expect(at('2026-10-12T10:00:00Z', 'crypto')).toBe('2026-10-11');
  });
});

describe('previousTradingDay', () => {
  it('skips weekends for exchanges', () => {
    expect(isoDay(previousTradingDay(utcDay('2026-10-12'), 'exchange'))).toBe('2026-10-09');
    expect(isoDay(previousTradingDay(utcDay('2026-10-09'), 'exchange'))).toBe('2026-10-08');
  });
  it('is the previous calendar day for crypto', () => {
    expect(isoDay(previousTradingDay(utcDay('2026-10-12'), 'crypto'))).toBe('2026-10-11');
  });
});

describe('marketOf', () => {
  it('maps crypto securities to the crypto market and everything else to exchange', () => {
    expect(marketOf('crypto')).toBe('crypto');
    expect(marketOf('etf')).toBe('exchange');
  });
});
