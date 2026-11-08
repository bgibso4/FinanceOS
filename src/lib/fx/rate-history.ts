import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { isoDay, utcDay } from '@/lib/investments/dates';
import type { FxHistorySource } from '@/lib/prices/types';

/** A day's rate may move at most this far from the previous accepted day. */
const MAX_DAILY_MOVE = 0.2;

export type RateFillResult = { pairs: string[]; days: number; failed: string[] };

/**
 * Keeps one daily ExchangeRate row per day for every foreign currency an active account uses,
 * to the base currency. A pair starts at its earliest activity (transaction or stored balance on
 * an account in that currency) and later fills restart at the last stored day, so downtime is
 * caught up and today's row is re-read. A pair whose answer is unusable writes nothing.
 */
export class ExchangeRateHistory {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly source: FxHistorySource,
    private readonly clock: Clock = systemClock
  ) {}

  async fill(): Promise<RateFillResult> {
    const today = utcDay(this.clock.now());
    const base = (await this.prisma.userSettings.findFirst())?.baseCurrency ?? 'USD';
    const accounts = await this.prisma.account.findMany({
      where: { isActive: true, currency: { not: base } },
      distinct: ['currency'],
      select: { currency: true },
      orderBy: { currency: 'asc' },
    });
    const result: RateFillResult = { pairs: [], days: 0, failed: [] };
    for (const { currency } of accounts) {
      const pair = `${currency}->${base}`;
      result.pairs.push(pair);
      try {
        result.days += await this.fillPair(currency, base, today);
      } catch (error) {
        console.warn(
          `[rates] ${pair} not updated: ${error instanceof Error ? error.message : error}`
        );
        result.failed.push(pair);
      }
    }
    return result;
  }

  /** Fetches and stores one pair; throws, storing nothing, if the provider or a rate is unusable. */
  private async fillPair(from: string, to: string, today: Date): Promise<number> {
    const last = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: from, toCurrency: to },
      orderBy: { date: 'desc' },
    });
    const start = last?.date ?? (await this.firstActivity(from)) ?? today;
    const { closes } = await this.source.getDailyHistory(
      this.source.fxSymbol(from, to),
      start,
      today
    );

    let previous = last?.rate;
    const sorted = [...closes].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const { date, close } of sorted) {
      if (!Number.isFinite(close) || close <= 0) {
        throw new Error(`unusable rate ${close} on ${isoDay(date)}`);
      }
      if (previous !== undefined && Math.abs(close / previous - 1) > MAX_DAILY_MOVE) {
        throw new Error(`rate ${close} on ${isoDay(date)} is too far from ${previous}`);
      }
      previous = close;
    }
    await this.prisma.$transaction(
      sorted.map(({ date, close }) => {
        const key = { fromCurrency: from, toCurrency: to, date };
        return this.prisma.exchangeRate.upsert({
          where: { fromCurrency_toCurrency_date: key },
          update: { rate: close },
          create: { ...key, rate: close },
        });
      })
    );
    return sorted.length;
  }

  /** Earliest transaction or stored balance on any account in `currency`. */
  private async firstActivity(currency: string): Promise<Date | null> {
    const where = { account: { currency } };
    const [transaction, balance] = await Promise.all([
      this.prisma.transaction.findFirst({
        where,
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.accountBalance.findFirst({
        where,
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const days = [transaction?.date, balance?.date].filter((d): d is Date => d != null);
    return days.length ? utcDay(new Date(Math.min(...days.map((d) => d.getTime())))) : null;
  }
}
