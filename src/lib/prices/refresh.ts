import type { PrismaClient, Security } from '@prisma/client';
import { BACKFILL_DAYS } from '@/lib/investments/history';
import { systemClock, type Clock } from '@/lib/clock';
import { addDays, utcDay } from '@/lib/investments/dates';
import { lastCompletedTradingDay, marketOf, previousTradingDay, type Market } from './trading-days';
import {
  PriceProviderError,
  type DailyHistory,
  type HistorySource,
  type PriceErrorKind,
} from './types';
import { PriceSource, Pricing, RecordSource } from '@/lib/investments/codes';

export const SYMBOL_GAP_MS = 500;
export const RETRY_DELAY_MS = 3000;
const FIRST_FETCH_LOOKBACK_DAYS = 30;
/**
 * Days fetched before a first holding or trade, so one on a non-trading day has a close
 * before it.
 */
const HISTORY_START_BUFFER_DAYS = 7;
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

export type PriceFreshness = { asOf: Date | null; stale: boolean };

const defaultSleep: Sleeper = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Brings stored daily closes up to the last completed trading day, and once back to each
 * security's history start (see historyStart), one provider call per range, sequentially. A second
 * consecutive failure stops the run; saved prices are kept. A symbol the provider can't answer
 * usably is skipped and the run continues.
 */
export class PriceRefresher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: HistorySource,
    private readonly clock: Clock = systemClock,
    private readonly sleep: Sleeper = defaultSleep
  ) {}

  /** `securityIds`: only these (market-priced) securities, even if nothing references them yet. */
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
        pricing: Pricing.Market,
        priceSymbol: { not: null },
        ...(opts.securityIds
          ? { id: { in: opts.securityIds } }
          : {
              OR: [
                { holdings: { some: {} } },
                { transactions: { some: {} } },
                { proxyFor: { some: {} } },
              ],
            }),
      },
      orderBy: { priceSymbol: 'asc' },
    });

    let calls = 0;
    /**
     * One paced provider call over [from, to], stored; failures are recorded on `result`. A
     * backward call the provider can't answer usably means nothing that early ('empty').
     */
    const fetchAndStore = async (
      security: Security,
      from: Date,
      to: Date,
      direction: 'forward' | 'backward'
    ): Promise<'stored' | 'empty' | 'skipped' | 'stopped'> => {
      const symbol = security.priceSymbol!;
      if (calls++ > 0) await this.sleep(SYMBOL_GAP_MS);
      let history: DailyHistory;
      try {
        history = await this.fetchWithRetry(symbol, from, to);
      } catch (error) {
        const unusable =
          error instanceof PriceProviderError &&
          (error.kind === 'unknown_symbol' || error.kind === 'bad_response');
        if (unusable && direction === 'backward') return 'empty';
        if (error instanceof PriceProviderError && error.kind === 'unknown_symbol') {
          await this.prisma.security.update({
            where: { id: security.id },
            data: { pricing: Pricing.None },
          });
          result.unknownSymbols.push(symbol);
          return 'skipped';
        }
        if (error instanceof PriceProviderError && error.kind === 'bad_response') {
          console.warn(`[prices] skipping ${symbol}: ${error.message}`);
          result.failedSymbols.push(symbol);
          return 'skipped';
        }
        result.stopped = true;
        result.error = `${symbol}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[prices] stopping price refresh: ${result.error}`);
        return 'stopped';
      }
      await this.storeHistory(security.id, history);
      return 'stored';
    };

    for (const security of securities) {
      const target = lastCompletedTradingDay(now, marketOf(security.type));
      const start = await this.historyStart(security.id, today);
      const latest = await this.latestStoredClose(security.id);
      let stored = false;

      // Forward: the day after the latest close (or the history start) through the target.
      const from = latest ? addDays(latest, 1) : start;
      if (from <= target) {
        const outcome = await fetchAndStore(security, from, target, 'forward');
        if (outcome === 'stopped') break;
        if (outcome === 'skipped') continue;
        stored = true;
        if (!latest) await this.markFetchedFrom(security.id, start);
      }

      // Backward, once: the days before the earliest stored close, back to the history start.
      if (latest && (!security.pricesFetchedFrom || security.pricesFetchedFrom > start)) {
        const earliest = await this.storedCloseDate(security.id, 'asc');
        if (earliest && start < earliest) {
          const outcome = await fetchAndStore(security, start, addDays(earliest, -1), 'backward');
          if (outcome === 'stopped') {
            if (stored) result.fetched++;
            break;
          }
          if (outcome === 'stored') stored = true;
        }
        await this.markFetchedFrom(security.id, start);
      }

      if (stored) result.fetched++;
      else result.upToDate++;
    }

    return result;
  }

  async latestStoredClose(securityId: string): Promise<Date | null> {
    return this.storedCloseDate(securityId, 'desc');
  }

  private async storedCloseDate(securityId: string, order: 'asc' | 'desc'): Promise<Date | null> {
    const row = await this.prisma.securityPrice.findFirst({
      where: { securityId, source: PriceSource.Market },
      orderBy: { date: order },
      select: { date: true },
    });
    return row?.date ?? null;
  }

  private async markFetchedFrom(securityId: string, day: Date): Promise<void> {
    await this.prisma.security.update({
      where: { id: securityId },
      data: { pricesFetchedFrom: day },
    });
  }

  /**
   * How current stored closes are for held market securities (or just `securityIds`). Each security
   * is judged on its own market's calendar, with one trading day of grace for unmodelled holidays:
   * stale when its latest close is older than the trading day before the last completed one.
   * `asOf` is the oldest latest close among exchange securities, else among crypto.
   */
  async freshness(opts: { securityIds?: string[] } = {}): Promise<PriceFreshness> {
    const now = this.clock.now();
    const securities = await this.prisma.security.findMany({
      where: {
        pricing: Pricing.Market,
        ...(opts.securityIds ? { id: { in: opts.securityIds } } : { holdings: { some: {} } }),
      },
      select: { id: true, type: true },
    });
    const oldest: Partial<Record<Market, Date>> = {};
    let stale = false;
    for (const s of securities) {
      const market = marketOf(s.type);
      const latest = await this.latestStoredClose(s.id);
      const grace = previousTradingDay(lastCompletedTradingDay(now, market), market);
      if (!latest || latest < grace) stale = true;
      const current = oldest[market];
      if (latest && (!current || latest < current)) oldest[market] = latest;
    }
    return { asOf: oldest.exchange ?? oldest.crypto ?? null, stale };
  }

  /**
   * The first day a security needs closes for, over it and the securities following it as a proxy:
   * a week before their earliest holding or trade, and for each synced account holding them, that
   * account's first synced holdings day minus BACKFILL_DAYS. Else a short lookback.
   */
  private async historyStart(securityId: string, today: Date): Promise<Date> {
    const followers = await this.prisma.security.findMany({
      where: { proxySecurityId: securityId },
      select: { id: true },
    });
    const ids = [securityId, ...followers.map((f) => f.id)];
    const [snapshot, trade, syncedHolders] = await Promise.all([
      this.prisma.holdingSnapshot.findFirst({
        where: { securityId: { in: ids } },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.investmentTransaction.findFirst({
        where: { securityId: { in: ids } },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.holdingSnapshot.findMany({
        where: { securityId: { in: ids }, source: RecordSource.Synced },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    const firstSyncedDays = syncedHolders.length
      ? await this.prisma.holdingSnapshot.groupBy({
          by: ['accountId'],
          where: {
            accountId: { in: syncedHolders.map((h) => h.accountId) },
            source: RecordSource.Synced,
          },
          _min: { date: true },
        })
      : [];
    const dates = [
      ...[snapshot?.date, trade?.date].map((d) => d && addDays(d, -HISTORY_START_BUFFER_DAYS)),
      ...firstSyncedDays.map((a) => a._min.date && addDays(a._min.date, -BACKFILL_DAYS)),
    ].filter((d): d is Date => d != null);
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
          where: {
            securityId_date_source: { securityId, date: c.date, source: PriceSource.Market },
          },
          create: { securityId, date: c.date, close: c.close, source: PriceSource.Market },
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
            source: PriceSource.Market,
          },
          update: { amount: e.amount, ratio: e.ratio },
        })
      ),
    ]);
  }
}
