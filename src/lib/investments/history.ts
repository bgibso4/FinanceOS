import type { AccountBalance, PrismaClient } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';
import { addDays, isoDay, lastAtOrBefore, utcDay } from './dates';
import { roundCents } from './money';
import { BalanceRowSource, BalanceSource, RecordSource, SecurityType } from './codes';

/**
 * How far before an account's first synced holdings its value is estimated, and prices are
 * fetched: the aggregator's investment-transaction history (24 months).
 */
export const BACKFILL_DAYS = 730;

/** The longest span of history served: ten years. `earliestDay` and the history route cap at it. */
export const MAX_DAYS = 3660;

export type SeriesPoint = { date: string; value: number; isEstimated: boolean };

/** A series re-expressed in another currency at today's rates, rounded to cents. */
export function convertSeries(
  points: SeriesPoint[],
  from: string,
  to: string,
  rates: Map<string, number>
): SeriesPoint[] {
  if (from === to) return points;
  return points.map((p) => ({ ...p, value: roundCents(convertAmount(p.value, from, to, rates)) }));
}

/** Day-by-day sum of series in one currency; a day is estimated when any member's point is. */
export function sumSeries(series: SeriesPoint[][]): SeriesPoint[] {
  const totals = new Map<string, { value: number; isEstimated: boolean }>();
  for (const points of series) {
    for (const p of points) {
      const total = totals.get(p.date) ?? { value: 0, isEstimated: false };
      total.value += p.value;
      total.isEstimated ||= p.isEstimated;
      totals.set(p.date, total);
    }
  }
  return [...totals.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, t]) => ({ date, value: roundCents(t.value), isEstimated: t.isEstimated }));
}

const QUANTITY_TYPES = new Set(['buy', 'sell', 'transfer']);

/** Quantities within this of zero count as zero (float noise from fractional shares). */
const QUANTITY_EPSILON = 1e-6;

type Position = { securityId: string; quantity: number; price: number; value: number };
type Flow = {
  date: Date;
  securityId: string | null;
  type: string;
  quantity: number | null;
  amount: number;
};

/** The accounts the investments page values. */
const ACTIVE_INVESTMENT = { trackingMode: 'investment', isActive: true } as const;

/** Daily value series for investment accounts, derived at read time (rules in Plan 2, Task 6). */
export class ValueHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async accountSeries(
    accountId: string,
    from: Date,
    to: Date,
    opts: { rates?: Map<string, number> } = {}
  ): Promise<SeriesPoint[]> {
    const prisma = this.prisma;
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, currency: true, balanceSource: true },
    });
    const rates = opts.rates ?? (await loadFxRates(prisma));
    const stored = await prisma.accountBalance.findMany({
      where: { accountId, date: { lte: to } },
      orderBy: { date: 'asc' },
    });
    const storedByDay = new Map(stored.map((r) => [r.date.getTime(), r]));
    const deriver =
      account.balanceSource === BalanceSource.Provider
        ? await ProviderValueDeriver.load(prisma, account, to, rates, storedByDay)
        : null;

    const points: SeriesPoint[] = [];
    let prev: AccountBalance | null = null;
    let i = 0;
    for (let d = utcDay(from); d <= to; d = addDays(d, 1)) {
      const t = d.getTime();
      while (i < stored.length && stored[i].date.getTime() < t) prev = stored[i++];
      const exact = storedByDay.get(t);
      if (exact) {
        points.push({ date: isoDay(d), value: exact.balance, isEstimated: false });
        continue;
      }
      const derived = deriver ? deriver.valueOn(d) : null;
      if (derived != null) {
        points.push({ date: isoDay(d), value: derived, isEstimated: true });
      } else if (prev) {
        points.push({
          date: isoDay(d),
          value: prev.balance,
          isEstimated: prev.source !== BalanceRowSource.Valuation,
        });
      }
    }
    return points;
  }

  /**
   * The first day any active investment account can have a value (the "All" range, spec §6): the
   * earliest stored balance, or an account's first synced holdings day minus BACKFILL_DAYS,
   * whichever is earlier, but never more than MAX_DAYS before today. Today when there's neither.
   */
  async earliestDay(today: Date): Promise<Date> {
    const [balance, synced] = await Promise.all([
      this.prisma.accountBalance.findFirst({
        where: { account: ACTIVE_INVESTMENT, date: { lte: today } },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.holdingSnapshot.findFirst({
        where: { account: ACTIVE_INVESTMENT, source: RecordSource.Synced },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const days = [balance?.date, synced && addDays(synced.date, -BACKFILL_DAYS)].filter(
      (d): d is Date => d != null
    );
    const earliest = Math.min(today.getTime(), ...days.map((d) => d.getTime()));
    return new Date(Math.max(earliest, addDays(today, -MAX_DAYS).getTime()));
  }

  async portfolioSeries(from: Date, to: Date, baseCurrency: string): Promise<SeriesPoint[]> {
    const accounts = await this.prisma.account.findMany({
      where: ACTIVE_INVESTMENT,
      select: { id: true, currency: true },
    });
    const rates = await loadFxRates(this.prisma);
    const series: SeriesPoint[][] = [];
    for (const a of accounts) {
      const points = await this.accountSeries(a.id, from, to, { rates });
      series.push(convertSeries(points, a.currency, baseCurrency, rates));
    }
    return sumSeries(series);
  }
}

/**
 * Estimates a provider account's value on days without a stored balance, from its synced holdings
 * snapshots and the trades after them, and before the first snapshot by undoing trades back from
 * it (spec §4). `load` reads everything once; `valueOn` is pure.
 */
class ProviderValueDeriver {
  /** Latest day before the first snapshot that can't be estimated (computed on first need). */
  private stopDay: number | undefined;
  /** Securities whose quantity some flow moves; their quantities are never interpolated. */
  private readonly traded: Set<string>;

  private constructor(
    private readonly snapshotDays: number[], // ascending
    private readonly setOn: Map<number, Position[]>,
    private readonly flows: Flow[], // non-cancelled, ascending
    private readonly cashSecurityIds: Set<string>,
    private readonly book: PriceBook,
    private readonly toAccount: (amount: number, securityId: string) => number,
    private readonly storedByDay: Map<number, AccountBalance>,
    /** Stored balance on the first snapshot day, read regardless of the requested range. */
    private readonly firstDayBalance: number | null
  ) {
    this.traded = new Set(flows.flatMap((x) => (this.movesQuantity(x) ? [x.securityId] : [])));
  }

  /**
   * Null when the account has no synced holdings snapshot. Snapshots after `to` are loaded too, so
   * the days just before the next one can interpolate toward it.
   */
  static async load(
    prisma: PrismaClient,
    account: { id: string; currency: string },
    to: Date,
    rates: Map<string, number>,
    storedByDay: Map<number, AccountBalance>
  ): Promise<ProviderValueDeriver | null> {
    const securitySelect = { select: { id: true, type: true, currency: true } };
    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { accountId: account.id, source: RecordSource.Synced },
      include: { security: securitySelect },
      orderBy: { date: 'asc' },
    });
    if (!snapshots.length) return null;
    const lastSnapshot = snapshots[snapshots.length - 1].date;
    // Everything is read to the same horizon so a day's value never depends on the requested range.
    const horizon = lastSnapshot > to ? lastSnapshot : to;
    const flows = await prisma.investmentTransaction.findMany({
      where: {
        accountId: account.id,
        isCancelled: false,
        type: { not: 'cancel' },
        date: { lte: horizon },
      },
      include: { security: securitySelect },
      orderBy: { date: 'asc' },
    });

    const setOn = new Map<number, Position[]>();
    for (const s of snapshots) {
      const t = s.date.getTime();
      setOn.set(t, [...(setOn.get(t) ?? []), s]);
    }
    const securities = new Map(
      [...snapshots, ...flows].flatMap((r) =>
        r.security ? [[r.security.id, r.security] as const] : []
      )
    );
    const book = await PriceBook.load(prisma, [...securities.keys()], horizon);
    const firstDayRow = await prisma.accountBalance.findFirst({
      where: { accountId: account.id, date: snapshots[0].date },
      select: { balance: true },
    });
    return new ProviderValueDeriver(
      [...setOn.keys()],
      setOn,
      flows,
      new Set(
        [...securities.values()].filter((s) => s.type === SecurityType.Cash).map((s) => s.id)
      ),
      book,
      (amount, securityId) =>
        convertAmount(
          amount,
          securities.get(securityId)?.currency ?? account.currency,
          account.currency,
          rates
        ),
      storedByDay,
      firstDayRow?.balance ?? null
    );
  }

  /**
   * Estimated value on day `d` from the latest snapshot on or before it; before the first, from
   * the first snapshot with later trades undone.
   */
  valueOn(d: Date): number | null {
    const t = d.getTime();
    if (t < this.snapshotDays[0]) {
      this.stopDay ??= this.findStopDay();
      return t > this.stopDay ? this.estimateBefore(d) : null;
    }
    const prevDay = lastAtOrBefore(this.snapshotDays, t)!;
    const nextDay = this.snapshotDays.find((s) => s > t);
    const prevSet = this.setOn.get(prevDay)!;
    const nextSet = nextDay === undefined ? [] : this.setOn.get(nextDay)!;
    const window = this.flows.filter((x) => x.date.getTime() > prevDay && x.date.getTime() <= t);
    const cashFlow = -this.cashAmount(window);

    const quantity = new Map(prevSet.map((s) => [s.securityId, s.quantity]));
    const fallbackPrice = new Map([...nextSet, ...prevSet].map((s) => [s.securityId, s.price]));
    for (const x of window) {
      if (!this.movesQuantity(x)) continue;
      quantity.set(x.securityId, (quantity.get(x.securityId) ?? 0) + x.quantity);
    }
    if (nextDay !== undefined) {
      const f = (t - prevDay) / (nextDay - prevDay);
      for (const s of prevSet) {
        if (this.traded.has(s.securityId) || this.isCash(s.securityId)) continue;
        const next = nextSet.find((n) => n.securityId === s.securityId);
        if (next) quantity.set(s.securityId, s.quantity + f * (next.quantity - s.quantity));
      }
    }
    const cashPosition = prevSet.find((s) => this.isCash(s.securityId));
    if (cashPosition) quantity.set(cashPosition.securityId, cashPosition.quantity + cashFlow);

    let value = 0;
    for (const [securityId, q] of quantity) {
      if (q <= 0) continue;
      const price = this.book.at(securityId, d)?.price ?? fallbackPrice.get(securityId);
      if (price != null) value += this.toAccount(q * price, securityId);
    }
    if (!cashPosition) {
      // Implicit cash: what the stored balance held beyond the snapshot's positions, moved by
      // flows.
      const anchor = this.storedByDay.get(prevDay);
      const held = this.heldValue(prevSet);
      value += (anchor ? anchor.balance - held : 0) + cashFlow;
    }
    return roundCents(value);
  }

  private isCash(securityId: string): boolean {
    return this.cashSecurityIds.has(securityId);
  }

  /** A flow that moves the quantity of a non-cash security: a trade or a share contribution. */
  private movesQuantity(x: Flow): x is Flow & { securityId: string; quantity: number } {
    if (!x.securityId || x.quantity == null || this.isCash(x.securityId)) return false;
    return QUANTITY_TYPES.has(x.type) || this.isShareContribution(x);
  }

  /**
   * A cash row carrying units of a non-cash security: the aggregator's form for retirement-plan
   * contributions, which buy the fund directly with no separate buy. Its amount never touches cash.
   */
  private isShareContribution(x: Flow): boolean {
    return (
      x.type === 'cash' &&
      !!x.securityId &&
      !this.isCash(x.securityId) &&
      Math.abs(x.quantity ?? 0) > QUANTITY_EPSILON
    );
  }

  /** Summed amounts of flows that move cash (positive = cash out). */
  private cashAmount(flows: Flow[]): number {
    return flows.reduce((sum, x) => sum + (this.isShareContribution(x) ? 0 : x.amount), 0);
  }

  /** A snapshot set's positions valued in the account currency. */
  private heldValue(set: Position[]): number {
    return set.reduce((sum, s) => sum + this.toAccount(s.value, s.securityId), 0);
  }

  /** First snapshot minus BACKFILL_DAYS, walking back until a day can't be estimated. */
  private findStopDay(): number {
    const first = new Date(this.snapshotDays[0]);
    const windowStart = addDays(first, -BACKFILL_DAYS);
    for (let d = addDays(first, -1); d >= windowStart; d = addDays(d, -1)) {
      if (this.estimateBefore(d) == null) return d.getTime();
    }
    return addDays(windowStart, -1).getTime();
  }

  /**
   * Value on a day before the first snapshot: its quantities and cash with every later trade and
   * cash flow (up to the snapshot) undone. Null when a quantity goes negative (a missing record)
   * or a held security has no price at all.
   */
  private estimateBefore(d: Date): number | null {
    const t = d.getTime();
    const firstDay = this.snapshotDays[0];
    const firstSet = this.setOn.get(firstDay)!;
    const later = this.flows.filter((x) => x.date.getTime() > t && x.date.getTime() <= firstDay);
    const undoneCash = this.cashAmount(later);

    const quantity = new Map(
      firstSet.filter((s) => !this.isCash(s.securityId)).map((s) => [s.securityId, s.quantity])
    );
    for (const x of later) {
      if (!this.movesQuantity(x)) continue;
      quantity.set(x.securityId, (quantity.get(x.securityId) ?? 0) - x.quantity);
    }

    const firstPrice = new Map(firstSet.map((s) => [s.securityId, s.price]));
    let value = 0;
    for (const [securityId, q] of quantity) {
      if (q < -QUANTITY_EPSILON) return null;
      if (q <= QUANTITY_EPSILON) continue;
      const price = this.book.at(securityId, d)?.price ?? firstPrice.get(securityId);
      if (price == null) return null;
      value += this.toAccount(q * price, securityId);
    }
    const cashPosition = firstSet.find((s) => this.isCash(s.securityId));
    if (cashPosition) {
      const units = cashPosition.quantity + undoneCash;
      const price = this.book.at(cashPosition.securityId, d)?.price ?? cashPosition.price;
      if (units > QUANTITY_EPSILON) value += this.toAccount(units * price, cashPosition.securityId);
    } else {
      // Implicit cash: what the first day's balance held beyond its positions, flows undone.
      const held = this.heldValue(firstSet);
      value += (this.firstDayBalance == null ? 0 : this.firstDayBalance - held) + undoneCash;
    }
    return roundCents(value);
  }
}
