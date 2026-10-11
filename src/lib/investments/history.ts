import type { AccountBalance, PrismaClient } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';
import { addDays, isoDay, lastAtOrBefore, utcDay } from './dates';
import { roundCents } from './money';

export type SeriesPoint = { date: string; value: number; isEstimated: boolean };

const QUANTITY_TYPES = new Set(['buy', 'sell', 'transfer']);

type Position = { securityId: string; quantity: number; price: number; value: number };
type Flow = {
  date: Date;
  securityId: string | null;
  type: string;
  quantity: number | null;
  amount: number;
};

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
      account.balanceSource === 'provider'
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
          isEstimated: prev.source !== 'valuation',
        });
      }
    }
    return points;
  }

  async portfolioSeries(from: Date, to: Date, baseCurrency: string): Promise<SeriesPoint[]> {
    const accounts = await this.prisma.account.findMany({
      where: { trackingMode: 'investment', isActive: true },
      select: { id: true, currency: true },
    });
    const rates = await loadFxRates(this.prisma);
    const totals = new Map<string, { value: number; isEstimated: boolean }>();
    for (const a of accounts) {
      for (const p of await this.accountSeries(a.id, from, to, { rates })) {
        const total = totals.get(p.date) ?? { value: 0, isEstimated: false };
        total.value += convertAmount(p.value, a.currency, baseCurrency, rates);
        total.isEstimated ||= p.isEstimated;
        totals.set(p.date, total);
      }
    }
    return [...totals.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([date, t]) => ({ date, value: roundCents(t.value), isEstimated: t.isEstimated }));
  }
}

/**
 * Estimates a provider account's value on days without a stored balance, from its Plaid holdings
 * snapshots and the trades after them. `load` reads everything once; `valueOn` is pure.
 */
class ProviderValueDeriver {
  private constructor(
    private readonly snapshotDays: number[], // ascending
    private readonly setOn: Map<number, Position[]>,
    private readonly flows: Flow[], // non-cancelled, ascending
    private readonly traded: Set<string>,
    private readonly cashSecurityIds: Set<string>,
    private readonly book: PriceBook,
    private readonly toAccount: (amount: number, securityId: string) => number,
    private readonly storedByDay: Map<number, AccountBalance>
  ) {}

  /**
   * Null when the account has no Plaid holdings snapshot. Snapshots after `to` are loaded too, so
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
      where: { accountId: account.id, source: 'plaid' },
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
    return new ProviderValueDeriver(
      [...setOn.keys()],
      setOn,
      flows,
      new Set(
        flows
          .filter((x) => x.securityId && x.quantity != null && QUANTITY_TYPES.has(x.type))
          .map((x) => x.securityId!)
      ),
      new Set([...securities.values()].filter((s) => s.type === 'cash').map((s) => s.id)),
      book,
      (amount, securityId) =>
        convertAmount(
          amount,
          securities.get(securityId)?.currency ?? account.currency,
          account.currency,
          rates
        ),
      storedByDay
    );
  }

  /** Estimated value on day `d` from the latest snapshot on or before it; null before the first. */
  valueOn(d: Date): number | null {
    const t = d.getTime();
    const prevDay = lastAtOrBefore(this.snapshotDays, t);
    if (prevDay === undefined) return null;
    const nextDay = this.snapshotDays.find((s) => s > t);
    const prevSet = this.setOn.get(prevDay)!;
    const nextSet = nextDay === undefined ? [] : this.setOn.get(nextDay)!;
    const window = this.flows.filter((x) => x.date.getTime() > prevDay && x.date.getTime() <= t);
    const cashFlow = -window.reduce((sum, x) => sum + x.amount, 0);
    const isCash = (securityId: string) => this.cashSecurityIds.has(securityId);

    const quantity = new Map(prevSet.map((s) => [s.securityId, s.quantity]));
    const fallbackPrice = new Map([...nextSet, ...prevSet].map((s) => [s.securityId, s.price]));
    for (const x of window) {
      if (
        !x.securityId ||
        x.quantity == null ||
        !QUANTITY_TYPES.has(x.type) ||
        isCash(x.securityId)
      ) {
        continue;
      }
      quantity.set(x.securityId, (quantity.get(x.securityId) ?? 0) + x.quantity);
    }
    if (nextDay !== undefined) {
      const f = (t - prevDay) / (nextDay - prevDay);
      for (const s of prevSet) {
        if (this.traded.has(s.securityId) || isCash(s.securityId)) continue;
        const next = nextSet.find((n) => n.securityId === s.securityId);
        if (next) quantity.set(s.securityId, s.quantity + f * (next.quantity - s.quantity));
      }
    }
    const cashPosition = prevSet.find((s) => isCash(s.securityId));
    if (cashPosition) quantity.set(cashPosition.securityId, cashPosition.quantity + cashFlow);

    let value = 0;
    for (const [securityId, q] of quantity) {
      if (q <= 0) continue;
      const price = this.book.at(securityId, d)?.price ?? fallbackPrice.get(securityId);
      if (price != null) value += this.toAccount(q * price, securityId);
    }
    if (!cashPosition) {
      // Implicit cash: what the stored balance held beyond the snapshot's positions, moved by flows.
      const anchor = this.storedByDay.get(prevDay);
      const held = prevSet.reduce((sum, s) => sum + this.toAccount(s.value, s.securityId), 0);
      value += (anchor ? anchor.balance - held : 0) + cashFlow;
    }
    return roundCents(value);
  }
}
