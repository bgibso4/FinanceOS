import YahooFinance from 'yahoo-finance2';
import { addDays, utcDay } from '@/lib/investments/dates';
import type { SecurityType } from '@/lib/investments/plaid-mapping';
import {
  PriceProviderError,
  type DailyHistory,
  type PriceErrorKind,
  type PriceEvent,
  type PriceProvider,
  type Quote,
  type SymbolMatch,
} from './types';

type ChartOptions = { period1: Date; period2: Date; interval: '1d'; events: string };
type ChartResult = {
  quotes: { date: Date; close: number | null }[];
  events?: {
    dividends?: { date: Date; amount: number }[];
    splits?: { date: Date; numerator: number; denominator: number }[];
  };
};
type SearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  isYahooFinance?: boolean;
};

/** The subset of yahoo-finance2 this adapter uses; injectable for tests. */
export type YahooClient = {
  chart(symbol: string, options: ChartOptions): Promise<ChartResult>;
  quote(
    symbol: string
  ): Promise<{ regularMarketPrice?: number; currency?: string; regularMarketTime?: Date }>;
  search(
    query: string,
    options: { quotesCount: number; newsCount: number }
  ): Promise<{ quotes: SearchQuote[] }>;
};

const QUOTE_TYPES: Record<string, SecurityType> = {
  EQUITY: 'equity',
  ETF: 'etf',
  MUTUALFUND: 'mutual_fund',
  CRYPTOCURRENCY: 'crypto',
  MONEYMARKET: 'money_market',
};

/** yahoo-finance2 errors raised for a response or request it can't use, not for transport. */
const BAD_RESPONSE_ERRORS = new Set(['FailedYahooValidationError', 'InvalidOptionsError']);

export function classifyYahooError(error: unknown): PriceErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && BAD_RESPONSE_ERRORS.has(error.name)) return 'bad_response';
  if (/schema validation|invalid options/i.test(message)) return 'bad_response';
  if (/too many requests|\b429\b/i.test(message)) return 'rate_limited';
  if (/not found|no data found|delisted|\b404\b|invalid symbol/i.test(message)) {
    return 'unknown_symbol';
  }
  return 'network';
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PriceProviderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PriceProviderError(classifyYahooError(error), message);
  }
}

/** `PriceProvider` backed by Yahoo Finance; every client error becomes a `PriceProviderError`. */
export class YahooPriceProvider implements PriceProvider {
  constructor(
    private readonly client: YahooClient = new YahooFinance() as unknown as YahooClient
  ) {}

  async getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory> {
    const res = await call(() =>
      this.client.chart(symbol, {
        period1: from,
        period2: addDays(to, 1),
        interval: '1d',
        events: 'div|split',
      })
    );
    const inRange = (d: Date) => {
      const day = utcDay(d);
      return day >= from && day <= to;
    };
    const closes = res.quotes
      .filter((q) => q.close != null && Number.isFinite(q.close) && inRange(q.date))
      .map((q) => ({ date: utcDay(q.date), close: q.close as number }));
    const events: PriceEvent[] = [
      ...(res.events?.dividends ?? [])
        .filter((d) => inRange(d.date))
        .map((d) => ({
          date: utcDay(d.date),
          type: 'dividend' as const,
          amount: d.amount,
          ratio: null,
        })),
      ...(res.events?.splits ?? [])
        .filter((s) => inRange(s.date))
        .map((s) => ({
          date: utcDay(s.date),
          type: 'split' as const,
          amount: null,
          ratio: s.numerator / s.denominator,
        })),
    ];
    return { closes, events };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const q = await call(() => this.client.quote(symbol));
    if (q?.regularMarketPrice == null) {
      throw new PriceProviderError('unknown_symbol', `No quote for ${symbol}`);
    }
    return {
      symbol,
      price: q.regularMarketPrice,
      currency: q.currency ?? 'USD',
      asOf: q.regularMarketTime ?? new Date(),
    };
  }

  async search(query: string): Promise<SymbolMatch[]> {
    const res = await call(() => this.client.search(query, { quotesCount: 8, newsCount: 0 }));
    return res.quotes
      .filter((q) => q.isYahooFinance && q.symbol)
      .map((q) => ({
        symbol: q.symbol!,
        name: q.shortname ?? q.longname ?? q.symbol!,
        type: QUOTE_TYPES[q.quoteType ?? ''] ?? 'other',
        exchange: q.exchange ?? null,
      }));
  }
}
