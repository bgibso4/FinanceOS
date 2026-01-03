/**
 * Currency utilities for multi-currency support
 * Handles formatting, conversion, and display logic
 */

export type Currency = 'USD' | 'CAD';

export type ExchangeRate = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
};

export type FormatOptions = {
  showCurrency?: boolean | 'auto'; // 'auto' shows currency only for non-base currencies
  baseCurrency?: Currency;
  exchangeRates?: Map<string, number>; // key format: "CAD_USD"
  showConverted?: boolean; // Show converted amount in parentheses
};

/**
 * Get currency symbol for a given currency code
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$',
    CAD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  };
  return symbols[currency] || currency;
}

/**
 * Get currency flag emoji
 */
export function getCurrencyFlag(currency: string): string {
  const flags: Record<string, string> = {
    USD: '🇺🇸',
    CAD: '🇨🇦',
    EUR: '🇪🇺',
    GBP: '🇬🇧',
    JPY: '🇯🇵',
  };
  return flags[currency] || '';
}

/**
 * Get exchange rate between two currencies
 */
export function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  rates: Map<string, number>
): number {
  if (fromCurrency === toCurrency) return 1;
  
  const key = `${fromCurrency}_${toCurrency}`;
  const rate = rates.get(key);
  
  if (rate !== undefined) return rate;
  
  // Try reverse rate
  const reverseKey = `${toCurrency}_${fromCurrency}`;
  const reverseRate = rates.get(reverseKey);
  if (reverseRate !== undefined) return 1 / reverseRate;
  
  // No rate found, return 1 (no conversion)
  console.warn(`No exchange rate found for ${fromCurrency} -> ${toCurrency}`);
  return 1;
}

/**
 * Convert amount from one currency to another
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Map<string, number>
): number {
  const rate = getExchangeRate(fromCurrency, toCurrency, rates);
  return amount * rate;
}

/**
 * Format amount with currency symbol and optional conversion
 */
export function formatAmount(
  amount: number,
  currency: string,
  options: FormatOptions = {}
): string {
  const {
    showCurrency = 'auto',
    baseCurrency = 'USD',
    exchangeRates = new Map(),
    showConverted = false,
  } = options;

  const symbol = getCurrencySymbol(currency);
  const isBaseCurrency = currency === baseCurrency;
  
  // Format the native amount
  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  // Determine if we should show currency code
  const shouldShowCurrency = 
    showCurrency === true || 
    (showCurrency === 'auto' && !isBaseCurrency);

  // Build the main display
  let display = `${amount < 0 ? '-' : ''}${symbol}${formattedAmount}`;
  if (shouldShowCurrency) {
    display += ` ${currency}`;
  }

  // Add converted amount if requested and not base currency
  if (showConverted && !isBaseCurrency && exchangeRates.size > 0) {
    const converted = convertAmount(amount, currency, baseCurrency, exchangeRates);
    const convertedFormatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(converted));
    const baseSymbol = getCurrencySymbol(baseCurrency);
    display += ` (${converted < 0 ? '-' : ''}${baseSymbol}${convertedFormatted})`;
  }

  return display;
}

/**
 * Format amount for display in lists (compact format)
 */
export function formatAmountCompact(
  amount: number,
  currency: string,
  baseCurrency: string = 'USD'
): string {
  return formatAmount(amount, currency, {
    showCurrency: 'auto',
    baseCurrency,
    showConverted: false,
  });
}

/**
 * Format amount with conversion info (for detailed views)
 */
export function formatAmountWithConversion(
  amount: number,
  currency: string,
  baseCurrency: string = 'USD',
  exchangeRates: Map<string, number> = new Map()
): string {
  return formatAmount(amount, currency, {
    showCurrency: 'auto',
    baseCurrency,
    exchangeRates,
    showConverted: true,
  });
}

/**
 * Format currency for analytics (always show in base currency)
 */
export function formatAmountForAnalytics(
  amount: number,
  currency: string,
  baseCurrency: string = 'USD',
  exchangeRates: Map<string, number> = new Map()
): number {
  if (currency === baseCurrency) return amount;
  return convertAmount(amount, currency, baseCurrency, exchangeRates);
}

/**
 * Get default exchange rates (can be overridden by user settings)
 */
export function getDefaultExchangeRates(): Map<string, number> {
  const rates = new Map<string, number>();
  rates.set('CAD_USD', 0.72); // 1 CAD = 0.72 USD (approximate)
  rates.set('EUR_USD', 1.10); // 1 EUR = 1.10 USD (approximate)
  rates.set('GBP_USD', 1.27); // 1 GBP = 1.27 USD (approximate)
  return rates;
}

/**
 * Parse exchange rates from database format
 */
export function parseExchangeRates(rates: ExchangeRate[]): Map<string, number> {
  const rateMap = new Map<string, number>();
  rates.forEach(r => {
    const key = `${r.fromCurrency}_${r.toCurrency}`;
    rateMap.set(key, r.rate);
  });
  return rateMap;
}

/**
 * Format exchange rate for display
 */
export function formatExchangeRate(rate: number): string {
  return rate.toFixed(4);
}

/**
 * Validate currency code
 */
export function isValidCurrency(currency: string): boolean {
  const validCurrencies = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'];
  return validCurrencies.includes(currency);
}
