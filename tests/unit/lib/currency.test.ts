import { describe, it, expect } from 'vitest';
import {
  getCurrencySymbol,
  getCurrencyFlag,
  convertAmount,
  formatAmount,
  formatAmountCompact,
  isValidCurrency,
} from '@/lib/currency';
import { RateBook } from '@/lib/fx/rate-book';
import { day } from '../../helpers/investments';

describe('currency', () => {
  describe('getCurrencySymbol', () => {
    it('returns correct symbols for known currencies', () => {
      expect(getCurrencySymbol('USD')).toBe('$');
      expect(getCurrencySymbol('CAD')).toBe('$');
      expect(getCurrencySymbol('EUR')).toBe('€');
      expect(getCurrencySymbol('GBP')).toBe('£');
      expect(getCurrencySymbol('JPY')).toBe('¥');
    });

    it('returns currency code for unknown currencies', () => {
      expect(getCurrencySymbol('XYZ')).toBe('XYZ');
    });
  });

  describe('getCurrencyFlag', () => {
    it('returns flags for known currencies', () => {
      expect(getCurrencyFlag('USD')).toBe('🇺🇸');
      expect(getCurrencyFlag('CAD')).toBe('🇨🇦');
      expect(getCurrencyFlag('EUR')).toBe('🇪🇺');
    });

    it('returns empty string for unknown currencies', () => {
      expect(getCurrencyFlag('XYZ')).toBe('');
    });
  });

  describe('convertAmount', () => {
    const rates = RateBook.of([
      { fromCurrency: 'EUR', toCurrency: 'USD', date: day('2026-11-05'), rate: 1.1 },
      { fromCurrency: 'EUR', toCurrency: 'USD', date: day('2026-11-06'), rate: 1.2 },
    ]);

    it('converts at the given day’s rate', () => {
      expect(convertAmount(100, 'EUR', 'USD', rates, '2026-11-05')).toBeCloseTo(110, 2);
      expect(convertAmount(100, 'EUR', 'USD', rates, '2026-11-06')).toBeCloseTo(120, 2);
    });

    it('converts at the latest rate when no day is given', () => {
      expect(convertAmount(100, 'EUR', 'USD', rates)).toBeCloseTo(120, 2);
    });

    it('returns same amount for same currency', () => {
      expect(convertAmount(100, 'USD', 'USD', rates)).toBe(100);
    });

    it('handles negative amounts', () => {
      expect(convertAmount(-100, 'EUR', 'USD', rates, '2026-11-05')).toBeCloseTo(-110, 2);
    });
  });

  describe('formatAmount', () => {
    it('formats amount with currency symbol', () => {
      expect(formatAmount(100, 'USD')).toBe('$100.00');
      expect(formatAmount(100, 'EUR')).toBe('€100.00 EUR');
    });

    it('handles negative amounts', () => {
      expect(formatAmount(-50.5, 'USD')).toBe('-$50.50');
    });

    it('formats with thousands separators', () => {
      expect(formatAmount(1234567.89, 'USD')).toBe('$1,234,567.89');
    });

    it('shows currency code when showCurrency is true', () => {
      expect(formatAmount(100, 'USD', { showCurrency: true })).toBe('$100.00 USD');
    });

    it('hides currency code when showCurrency is false', () => {
      expect(formatAmount(100, 'EUR', { showCurrency: false })).toBe('€100.00');
    });
  });

  describe('formatAmountCompact', () => {
    it('formats amount in compact style', () => {
      expect(formatAmountCompact(100, 'USD')).toBe('$100.00');
    });

    it('shows currency code for non-base currencies', () => {
      expect(formatAmountCompact(100, 'EUR', 'USD')).toBe('€100.00 EUR');
    });

    it('hides currency code for base currency', () => {
      expect(formatAmountCompact(100, 'EUR', 'EUR')).toBe('€100.00');
    });
  });

  describe('isValidCurrency', () => {
    it('returns true for valid currencies', () => {
      expect(isValidCurrency('USD')).toBe(true);
      expect(isValidCurrency('CAD')).toBe(true);
      expect(isValidCurrency('EUR')).toBe(true);
      expect(isValidCurrency('GBP')).toBe(true);
      expect(isValidCurrency('JPY')).toBe(true);
    });

    it('returns false for invalid currencies', () => {
      expect(isValidCurrency('XYZ')).toBe(false);
      expect(isValidCurrency('')).toBe(false);
      expect(isValidCurrency('usd')).toBe(false); // case-sensitive
    });
  });
});
