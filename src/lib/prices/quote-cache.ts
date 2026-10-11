import { systemClock, type Clock } from '@/lib/clock';
import type { Quote, QuoteSource } from './types';

const QUOTE_TTL_MS = 15 * 60 * 1000;

/** Latest quote per symbol, reused for `ttlMs`. Failures are not cached. */
export class QuoteCache {
  private readonly entries = new Map<string, { quote: Quote; fetchedAt: number }>();

  constructor(
    private readonly source: QuoteSource,
    private readonly clock: Clock = systemClock,
    private readonly ttlMs = QUOTE_TTL_MS
  ) {}

  async get(symbol: string): Promise<Quote> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(symbol);
    if (hit && now - hit.fetchedAt < this.ttlMs) return hit.quote;
    const quote = await this.source.getQuote(symbol);
    this.entries.set(symbol, { quote, fetchedAt: now });
    return quote;
  }
}
