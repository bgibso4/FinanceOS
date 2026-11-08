/**
 * Currency utilities for multi-currency support
 * Handles formatting, conversion, and display logic
 */

import type { PrismaClient } from '@prisma/client';
import { RateBook } from '@/lib/fx/rate-book';

/** Currencies a user can pick as their base; also what the settings route accepts. */
export const BASE_CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
] as const;

export type Currency = 'USD' | 'CAD';

export type FormatOptions = {
  showCurrency?: boolean | 'auto'; // 'auto' shows currency only for non-base currencies
  baseCurrency?: Currency;
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
 * Convert amount from one currency to another on `day` (YYYY-MM-DD); no day means the latest rate.
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: RateBook,
  day?: string
): number {
  return rates.convert(amount, fromCurrency, toCurrency, day);
}

/**
 * Format amount with currency symbol and optional conversion
 */
export function formatAmount(
  amount: number,
  currency: string,
  options: FormatOptions = {}
): string {
  const { showCurrency = 'auto', baseCurrency = 'USD' } = options;

  const symbol = getCurrencySymbol(currency);
  const isBaseCurrency = currency === baseCurrency;

  // Format the native amount
  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  // Determine if we should show currency code
  const shouldShowCurrency = showCurrency === true || (showCurrency === 'auto' && !isBaseCurrency);

  // Build the main display
  let display = `${amount < 0 ? '-' : ''}${symbol}${formattedAmount}`;
  if (shouldShowCurrency) {
    display += ` ${currency}`;
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
    baseCurrency: baseCurrency as Currency,
  });
}

/**
 * Validate currency code
 */
export function isValidCurrency(currency: string): boolean {
  const validCurrencies = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'];
  return validCurrencies.includes(currency);
}

export type CurrencySettings = { rates: RateBook; baseCurrency: string };

/** Exchange rates and base currency from the database. */
export async function loadCurrencySettings(prisma: PrismaClient): Promise<CurrencySettings> {
  const [rates, settings] = await Promise.all([
    RateBook.load(prisma),
    prisma.userSettings.findFirst(),
  ]);
  return {
    rates,
    baseCurrency: settings?.baseCurrency || 'USD',
  };
}

/** Convert an amount in `currency` (default USD) to the base currency, on `day` or the latest. */
export function toBase(
  amount: number,
  currency: string | undefined,
  s: CurrencySettings,
  day?: string
): number {
  return convertAmount(amount, currency || 'USD', s.baseCurrency, s.rates, day);
}

export const MINUS = '−';

export const moneySymbol = (currency = 'USD') =>
  currency === 'CAD' ? 'CA$' : getCurrencySymbol(currency);

export type MoneyOpts = { cents?: boolean; currency?: string };

/** `$1,234`, `CA$1,234`, `−$5` (U+2212). Whole units unless `cents`. */
export function fmtMoney(v: number, opts: MoneyOpts = {}): string {
  const digits = opts.cents ? 2 : 0;
  const rounded = Number(v.toFixed(digits));
  const body = Math.abs(rounded).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${rounded < 0 ? MINUS : ''}${moneySymbol(opts.currency)}${body}`;
}
