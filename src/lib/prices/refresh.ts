import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { addDays, utcDay } from '@/lib/investments/dates';
import { lastCompletedTradingDay } from './trading-days';
import {
  PriceProviderError,
  type DailyHistory,
  type HistorySource,
  type PriceErrorKind,
} from './types';

export const SYMBOL_GAP_MS = 500;
export const RETRY_DELAY_MS = 3000;
const FIRST_FETCH_LOOKBACK_DAYS = 30;
/** Transient failures worth one retry; anything else (unknown symbol, bad response) is final. */
const RETRYABLE = new Set<PriceErrorKind>(['rate_limited', 'network']);

export type Sleeper = (ms: number) => Promise<void>;

export type PriceRefreshResult = {
  fetched: number;
  upToDate: number;
  unknownSymbols: string[];
  /** Symbols skipped this run because the provider's answer was unusable (pricing unchanged). */
  failedSymbols: string[];
  stopped: boolean;
  error: string | null;
};

const defaultSleep: Sleeper = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Brings stored daily closes up to the last completed trading day, one provider call per stale
 * symbol, sequentially. A second consecutive failure stops the run; saved prices are kept. A
 * symbol the provider can't answer usably is skipped and the run continues.
 */
export class PriceRefresher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: HistorySource,
    private readonly clock: Clock = systemClock,
    private readonly sleep: Sleeper = defaultSleep
  ) {}

  /** `securityIds`: only these (feed-priced) securities, even if nothing references them yet. */
  async refresh(opts: { securityIds?: string[] } = {}): Promise<PriceRefreshResult> {
    const now = this.clock.now();
    const today = utcDay(now);
    const result: PriceRefreshResult = {
      fetched: 0,
      upToDate: 0,
      unknownSymbols: [],
      failedSymbols: [],
      stopped: false,
      error: null,
    };

    const securities = await this.prisma.security.findMany({
      where: {
        pricing: 'feed',
        priceSymbol: { not: null },
        ...(opts.securityIds
          ? { id: { in: opts.securityIds } }
          : { OR: [{ holdings: { some: {} } }, { transactions: { some: {} } }] }),
      },
      orderBy: { priceSymbol: 'asc' },
    });

    let calls = 0;
    for (const security of securities) {
      const symbol = security.priceSymbol!;
      const market = security.type === 'crypto' ? 'crypto' : 'exchange';
      const target = lastCompletedTradingDay(now, market);
      const latest = await this.latestStoredClose(security.id);
      const from = latest ? addDays(latest, 1) : await this.firstNeededDay(security.id, today);
      if (from > target) {
        result.upToDate++;
        continue;
      }

      if (calls++ > 0) await this.sleep(SYMBOL_GAP_MS);
      let history: DailyHistory;
      try {
        history = await this.fetchWithRetry(symbol, from, target);
      } catch (error) {
        if (error instanceof PriceProviderError && error.kind === 'unknown_symbol') {
          await this.prisma.security.update({
            where: { id: security.id },
            data: { pricing: 'none' },
          });
          result.unknownSymbols.push(symbol);
          continue;
        }
        if (error instanceof PriceProviderError && error.kind === 'bad_response') {
          console.warn(`[prices] skipping ${symbol}: ${error.message}`);
          result.failedSymbols.push(symbol);
          continue;
        }
        result.stopped = true;
        result.error = `${symbol}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[prices] stopping price refresh: ${result.error}`);
        break;
      }
      await this.storeHistory(security.id, history);
      result.fetched++;
    }

    return result;
  }

  async latestStoredClose(securityId: string): Promise<Date | null> {
    const row = await this.prisma.securityPrice.findFirst({
      where: { securityId, source: 'yahoo' },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return row?.date ?? null;
  }

  /** Oldest "latest Yahoo close" across held feed securities: the honest "prices as of". */
  async pricesAsOf(): Promise<Date | null> {
    const securities = await this.prisma.security.findMany({
      where: { pricing: 'feed', holdings: { some: {} } },
      select: { id: true },
    });
    let oldest: Date | null = null;
    for (const { id } of securities) {
      const latest = await this.latestStoredClose(id);
      if (latest && (!oldest || latest < oldest)) oldest = latest;
    }
    return oldest;
  }

  /** First day a never-priced security needs: its earliest holding or trade, else a short lookback. */
  private async firstNeededDay(securityId: string, today: Date): Promise<Date> {
    const [snapshot, trade] = await Promise.all([
      this.prisma.holdingSnapshot.findFirst({
        where: { securityId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.investmentTransaction.findFirst({
        where: { securityId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const dates = [snapshot?.date, trade?.date].filter((d): d is Date => d != null);
    if (!dates.length) return addDays(today, -FIRST_FETCH_LOOKBACK_DAYS);
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  }

  private async fetchWithRetry(symbol: string, from: Date, to: Date): Promise<DailyHistory> {
    try {
      return await this.provider.getDailyHistory(symbol, from, to);
    } catch (error) {
      if (error instanceof PriceProviderError && !RETRYABLE.has(error.kind)) throw error;
      await this.sleep(RETRY_DELAY_MS);
      return this.provider.getDailyHistory(symbol, from, to);
    }
  }

  private async storeHistory(securityId: string, history: DailyHistory): Promise<void> {
    const prisma = this.prisma;
    await prisma.$transaction([
      ...history.closes.map((c) =>
        prisma.securityPrice.upsert({
          where: { securityId_date_source: { securityId, date: c.date, source: 'yahoo' } },
          create: { securityId, date: c.date, close: c.close, source: 'yahoo' },
          update: { close: c.close },
        })
      ),
      ...history.events.map((e) =>
        prisma.securityEvent.upsert({
          where: { securityId_date_type: { securityId, date: e.date, type: e.type } },
          create: {
            securityId,
            date: e.date,
            type: e.type,
            amount: e.amount,
            ratio: e.ratio,
            source: 'yahoo',
          },
          update: { amount: e.amount, ratio: e.ratio },
        })
      ),
    ]);
  }
}
