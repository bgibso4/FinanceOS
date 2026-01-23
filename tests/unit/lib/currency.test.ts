import { describe, it, expect } from 'vitest';
import {
  getCurrencySymbol,
  getCurrencyFlag,
  getExchangeRate,
  convertAmount,
  formatAmount,
  formatAmountCompact,
  formatAmountWithConversion,
  formatAmountForAnalytics,
  getDefaultExchangeRates,
  parseExchangeRates,
  formatExchangeRate,
  isValidCurrency,
} from '@/lib/currency';

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

  describe('getExchangeRate', () => {
    const rates = new Map<string, number>([
      ['EUR_USD', 1.1],
      ['GBP_USD', 1.27],
      ['CAD_USD', 0.72],
    ]);

    it('returns 1 for same currency', () => {
      expect(getExchangeRate('USD', 'USD', rates)).toBe(1);
      expect(getExchangeRate('EUR', 'EUR', rates)).toBe(1);
    });

    it('returns direct rate when available', () => {
      expect(getExchangeRate('EUR', 'USD', rates)).toBe(1.1);
      expect(getExchangeRate('CAD', 'USD', rates)).toBe(0.72);
    });

    it('calculates reverse rate when direct not available', () => {
      // USD to EUR = 1 / 1.1 = 0.909...
      expect(getExchangeRate('USD', 'EUR', rates)).toBeCloseTo(0.909, 2);
    });

    it('returns 1 when no rate found (no conversion)', () => {
      expect(getExchangeRate('XYZ', 'USD', rates)).toBe(1);
    });
  });

  describe('convertAmount', () => {
    const rates = new Map<string, number>([
      ['EUR_USD', 1.1],
      ['CAD_USD', 0.72],
    ]);

    it('converts EUR to USD', () => {
      expect(convertAmount(100, 'EUR', 'USD', rates)).toBeCloseTo(110, 2);
    });

    it('converts CAD to USD', () => {
      expect(convertAmount(100, 'CAD', 'USD', rates)).toBeCloseTo(72, 2);
    });

    it('converts USD to EUR (using reverse rate)', () => {
      expect(convertAmount(110, 'USD', 'EUR', rates)).toBeCloseTo(100, 0);
    });

    it('returns same amount for same currency', () => {
      expect(convertAmount(100, 'USD', 'USD', rates)).toBe(100);
    });

    it('handles negative amounts', () => {
      expect(convertAmount(-100, 'EUR', 'USD', rates)).toBeCloseTo(-110, 2);
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

    it('shows converted amount when showConverted is true', () => {
      const rates = new Map([['EUR_USD', 1.1]]);
      const result = formatAmount(100, 'EUR', {
        baseCurrency: 'USD',
        exchangeRates: rates,
        showConverted: true,
      });

      expect(result).toContain('€100.00 EUR');
      expect(result).toContain('($110.00)');
    });

    it('does not show conversion for base currency', () => {
      const rates = new Map([['EUR_USD', 1.1]]);
      const result = formatAmount(100, 'USD', {
        baseCurrency: 'USD',
        exchangeRates: rates,
        showConverted: true,
      });

      expect(result).toBe('$100.00');
      expect(result).not.toContain('(');
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

  describe('formatAmountWithConversion', () => {
    it('shows conversion for non-base currencies', () => {
      const rates = new Map([['CAD_USD', 0.72]]);
      const result = formatAmountWithConversion(100, 'CAD', 'USD', rates);

      expect(result).toContain('$100.00 CAD');
      expect(result).toContain('($72.00)');
    });
  });

  describe('formatAmountForAnalytics', () => {
    const rates = new Map([['EUR_USD', 1.1]]);

    it('returns original amount for base currency', () => {
      expect(formatAmountForAnalytics(100, 'USD', 'USD', rates)).toBe(100);
    });

    it('converts to base currency for non-base', () => {
      expect(formatAmountForAnalytics(100, 'EUR', 'USD', rates)).toBeCloseTo(110, 2);
    });
  });

  describe('getDefaultExchangeRates', () => {
    it('returns map with default rates', () => {
      const rates = getDefaultExchangeRates();

      expect(rates.get('CAD_USD')).toBe(0.72);
      expect(rates.get('EUR_USD')).toBe(1.1);
      expect(rates.get('GBP_USD')).toBe(1.27);
    });
  });

  describe('parseExchangeRates', () => {
    it('converts array of rate objects to map', () => {
      const rateObjects = [
        { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.1 },
        { fromCurrency: 'GBP', toCurrency: 'USD', rate: 1.27 },
      ];

      const rateMap = parseExchangeRates(rateObjects);

      expect(rateMap.get('EUR_USD')).toBe(1.1);
      expect(rateMap.get('GBP_USD')).toBe(1.27);
    });

    it('handles empty array', () => {
      const rateMap = parseExchangeRates([]);
      expect(rateMap.size).toBe(0);
    });
  });

  describe('formatExchangeRate', () => {
    it('formats rate with 4 decimal places', () => {
      expect(formatExchangeRate(1.1)).toBe('1.1000');
      expect(formatExchangeRate(0.72456789)).toBe('0.7246');
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
