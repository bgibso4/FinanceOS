import { describe, it, expect } from 'vitest';
import { RateBook } from '@/lib/fx/rate-book';
import { expectWarning } from '../../../helpers/investments';

const book = RateBook.of([
  {
    fromCurrency: 'CAD',
    toCurrency: 'USD',
    date: new Date('2026-11-06T00:00:00.000Z'),
    rate: 0.73,
  },
  {
    fromCurrency: 'CAD',
    toCurrency: 'USD',
    date: new Date('2026-11-05T00:00:00.000Z'),
    rate: 0.72,
  },
]);

describe('RateBook', () => {
  it('exactDayRate', () => {
    expect(book.rate('CAD', 'USD', '2026-11-06')).toBe(0.73);
    expect(book.rate('CAD', 'USD', '2026-11-05')).toBe(0.72);
  });

  it('weekendUsesEarlierDay', () => {
    expect(book.rate('CAD', 'USD', '2026-11-08')).toBe(0.73);
  });

  it('beforeHistoryUsesEarliest', () => {
    expect(book.rate('CAD', 'USD', '2025-01-01')).toBe(0.72);
  });

  it('noDayUsesLatest', () => {
    expect(book.rate('CAD', 'USD')).toBe(0.73);
  });

  it('inversePairUsesReciprocal', () => {
    expect(book.rate('USD', 'CAD', '2026-11-05')).toBeCloseTo(1 / 0.72, 10);
  });

  it('sameCurrencyIsOne', () => {
    expect(book.rate('USD', 'USD', '2026-11-05')).toBe(1);
  });

  it('missingPairWarnsAndReturnsOne', async () => {
    const rate = await expectWarning('No exchange rate found for EUR -> USD', async () =>
      book.rate('EUR', 'USD', '2026-11-05')
    );
    expect(rate).toBe(1);
  });

  it('convertMultipliesByTheDayRate', () => {
    expect(book.convert(100, 'CAD', 'USD', '2026-11-05')).toBeCloseTo(72, 10);
  });

  it('latestReturnsRateAndDay', () => {
    expect(book.latest('CAD', 'USD')).toEqual({ rate: 0.73, date: '2026-11-06' });
    expect(book.latest('EUR', 'USD')).toBeNull();
  });
});
