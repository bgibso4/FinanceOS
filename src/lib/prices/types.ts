import type { SecurityType } from '@/lib/investments/plaid-mapping';

export type DailyClose = { date: Date; close: number };

export type PriceEvent = {
  date: Date;
  type: 'dividend' | 'split';
  amount: number | null;
  ratio: number | null;
};

export type DailyHistory = { closes: DailyClose[]; events: PriceEvent[] };

export type Quote = { symbol: string; price: number; currency: string; asOf: Date };

export type SymbolMatch = {
  symbol: string;
  name: string;
  type: SecurityType;
  exchange: string | null;
};

export type PriceErrorKind = 'rate_limited' | 'network' | 'unknown_symbol';

export class PriceProviderError extends Error {
  readonly kind: PriceErrorKind;

  constructor(kind: PriceErrorKind, message: string) {
    super(message);
    this.name = 'PriceProviderError';
    this.kind = kind;
  }
}

export interface PriceProvider {
  /** Raw daily closes (null bars dropped) and dividend/split events for inclusive UTC days. */
  getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  getQuote(symbol: string): Promise<Quote>;
  search(query: string): Promise<SymbolMatch[]>;
}

/** Narrowed views: each consumer depends only on the provider methods it calls. */
export type HistorySource = Pick<PriceProvider, 'getDailyHistory'>;
export type QuoteSource = Pick<PriceProvider, 'getQuote'>;
export type SymbolLookup = Pick<PriceProvider, 'search'>;
