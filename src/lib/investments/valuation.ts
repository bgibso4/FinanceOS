import type { Account, AccountBalance, HoldingSnapshot, PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { convertAmount } from '@/lib/currency';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';
import { InvestmentInputError, requireInvestmentAccount } from './account-guard';
import { addDays, lastAtOrBefore, utcDay } from './dates';
import type { ManualHoldingService } from './manual-holding';
import { roundCents } from './money';

export type HoldingInput = { securityId: string; quantity: number };

/** Valued investment accounts: user-entered holdings × stored prices → `AccountBalance` rows. */
export class ValuationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly manualHoldings: ManualHoldingService,
    private readonly clock: Clock = systemClock
  ) {}

  latestBalance(accountId: string): Promise<AccountBalance | null> {
    return this.prisma.accountBalance.findFirst({
      where: { accountId, source: 'valuation' },
      orderBy: { date: 'desc' },
    });
  }

  /** Replace today's holdings (earlier days keep the set in effect then) and revalue the account. */
  async setHoldings(accountId: string, holdings: HoldingInput[]): Promise<HoldingSnapshot[]> {
    const prisma = this.prisma;
    await requireInvestmentAccount(prisma, accountId, 'valuation');
    if (!holdings.length) {
      throw new InvestmentInputError('A valued account needs at least one holding');
    }
    if (holdings.some((h) => !Number.isFinite(h.quantity) || h.quantity <= 0)) {
      throw new InvestmentInputError('Quantities must be positive numbers');
    }
    const ids = holdings.map((h) => h.securityId);
    if (new Set(ids).size !== ids.length) {
      throw new InvestmentInputError('Each security can appear only once');
    }
    if ((await prisma.security.count({ where: { id: { in: ids } } })) !== ids.length) {
      throw new InvestmentInputError('Unknown security');
    }

    const today = utcDay(this.clock.now());
    const book = await PriceBook.load(prisma, ids, today);
    await prisma.$transaction([
      // A manual account switching to Valued drops its single-holding mirror on first entry.
      ...this.manualHoldings.removalOps(accountId),
      prisma.holdingSnapshot.deleteMany({ where: { accountId, date: today } }),
      ...holdings.map((h) => {
        const price = book.at(h.securityId, today)?.price ?? 0;
        return prisma.holdingSnapshot.create({
          data: {
            accountId,
            securityId: h.securityId,
            date: today,
            quantity: h.quantity,
            price,
            value: h.quantity * price,
            source: 'manual',
          },
        });
      }),
    ]);
    await this.writeBalances({ accountIds: [accountId] });
    return prisma.holdingSnapshot.findMany({ where: { accountId, date: today } });
  }

  async writeBalances(opts: { accountIds?: string[] } = {}): Promise<number> {
    const today = utcDay(this.clock.now());
    const accounts = await this.prisma.account.findMany({
      where: {
        trackingMode: 'investment',
        balanceSource: 'valuation',
        ...(opts.accountIds ? { id: { in: opts.accountIds } } : {}),
      },
    });
    const rates = await loadFxRates(this.prisma);
    let written = 0;
    for (const account of accounts) written += await this.valueAccount(account, today, rates);
    return written;
  }

  private async valueAccount(
    account: Account,
    today: Date,
    rates: Map<string, number>
  ): Promise<number> {
    const prisma = this.prisma;
    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { accountId: account.id, date: { lte: today } },
      include: { security: { select: { currency: true } } },
      orderBy: { date: 'asc' },
    });
    if (!snapshots.length) return 0;
    const last = await prisma.accountBalance.findFirst({
      where: { accountId: account.id, source: 'valuation' },
      orderBy: { date: 'desc' },
    });
    const start = last ? last.date : snapshots[0].date;
    const securityIds = [...new Set(snapshots.map((s) => s.securityId))];
    const book = await PriceBook.load(prisma, securityIds, today);
    const [prices, existingRows] = await Promise.all([
      prisma.securityPrice.findMany({
        where: { securityId: { in: securityIds }, date: { gte: start, lte: today } },
        select: { date: true },
      }),
      prisma.accountBalance.findMany({ where: { accountId: account.id, date: { gte: start } } }),
    ]);
    const priceDays = new Set(prices.map((p) => p.date.getTime()));
    const setDays = [...new Set(snapshots.map((s) => s.date.getTime()))];
    const existing = new Map(existingRows.map((r) => [r.date.getTime(), r]));

    let written = 0;
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const t = d.getTime();
      if (t !== today.getTime() && !priceDays.has(t) && !setDays.includes(t)) continue;
      const setDay = lastAtOrBefore(setDays, t);
      if (setDay === undefined) continue;
      let value = 0;
      let complete = true;
      for (const h of snapshots.filter((s) => s.date.getTime() === setDay)) {
        const priced = book.at(h.securityId, d);
        if (!priced) {
          complete = false;
          break;
        }
        value += convertAmount(
          h.quantity * priced.price,
          h.security.currency,
          account.currency,
          rates
        );
      }
      const prev = existing.get(t);
      if (!complete) {
        // A day that can no longer be valued must not keep its earlier valuation row.
        if (prev?.source === 'valuation') {
          await prisma.accountBalance.delete({ where: { id: prev.id } });
        }
        continue;
      }
      const balance = roundCents(value);
      if (prev?.source === 'valuation' && prev.balance === balance) continue;
      await prisma.accountBalance.upsert({
        where: { accountId_date: { accountId: account.id, date: d } },
        create: {
          accountId: account.id,
          date: d,
          balance,
          currency: account.currency,
          source: 'valuation',
        },
        update: { balance, source: 'valuation' },
      });
      written++;
    }
    return written;
  }
}
