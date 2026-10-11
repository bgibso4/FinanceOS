import type { AccountBalance, Prisma, PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError, requireInvestmentAccount } from './account-guard';
import { utcDay } from './dates';

export const manualHoldingSecurityId = (accountId: string) => `manual-holding-${accountId}`;

/** Manual investment accounts: dated balance entries, mirrored as one synthetic holding. */
export class ManualHoldingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock = systemClock
  ) {}

  async record(
    accountId: string,
    input: { date: string | Date; balance: number }
  ): Promise<AccountBalance> {
    const account = await requireInvestmentAccount(this.prisma, accountId, 'manual');
    if (!Number.isFinite(input.balance)) throw new InvestmentInputError('Balance must be a number');
    const date = utcDay(input.date);
    if (date > utcDay(this.clock.now())) {
      throw new InvestmentInputError('Balance date cannot be in the future');
    }
    const row = await this.prisma.accountBalance.upsert({
      where: { accountId_date: { accountId, date } },
      create: {
        accountId,
        date,
        balance: input.balance,
        currency: account.currency,
        source: 'manual',
      },
      update: { balance: input.balance, source: 'manual' },
    });
    await this.sync(accountId);
    return row;
  }

  async delete(accountId: string, balanceId: string): Promise<void> {
    await requireInvestmentAccount(this.prisma, accountId, 'manual');
    const { count } = await this.prisma.accountBalance.deleteMany({
      where: { id: balanceId, accountId, source: 'manual' },
    });
    if (!count) throw new InvestmentInputError('Balance entry not found', 404);
    await this.sync(accountId);
  }

  async list(accountId: string): Promise<AccountBalance[]> {
    await requireInvestmentAccount(this.prisma, accountId, 'manual');
    return this.prisma.accountBalance.findMany({
      where: { accountId, source: 'manual' },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Make the account's holdings exactly one snapshot per manual balance entry, on the account's
   * synthetic security. Returns false (and writes nothing) when they already match.
   */
  async sync(accountId: string): Promise<boolean> {
    const prisma = this.prisma;
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const securityId = manualHoldingSecurityId(accountId);
    const [balances, snapshots] = await Promise.all([
      prisma.accountBalance.findMany({
        where: { accountId, source: 'manual' },
        orderBy: { date: 'asc' },
      }),
      prisma.holdingSnapshot.findMany({ where: { accountId }, orderBy: { date: 'asc' } }),
    ]);
    const inSync =
      snapshots.length === balances.length &&
      balances.every(
        (b, i) =>
          snapshots[i].securityId === securityId &&
          snapshots[i].date.getTime() === b.date.getTime() &&
          snapshots[i].value === b.balance
      );
    if (inSync) return false;

    await prisma.security.upsert({
      where: { id: securityId },
      create: {
        id: securityId,
        name: account.name,
        type: 'other',
        currency: account.currency,
        pricing: 'manual',
      },
      update: { name: account.name, currency: account.currency },
    });
    await prisma.$transaction([
      prisma.holdingSnapshot.deleteMany({ where: { accountId } }),
      prisma.securityPrice.deleteMany({ where: { securityId } }),
      ...balances.flatMap((b) => [
        prisma.holdingSnapshot.create({
          data: {
            accountId,
            securityId,
            date: b.date,
            quantity: 1,
            price: b.balance,
            value: b.balance,
            source: 'manual',
          },
        }),
        prisma.securityPrice.create({
          data: { securityId, date: b.date, close: b.balance, source: 'manual' },
        }),
      ]),
    ]);
    return true;
  }

  async syncAll(): Promise<number> {
    const accounts = await this.prisma.account.findMany({
      where: { trackingMode: 'investment', balanceSource: 'manual' },
      select: { id: true },
    });
    let changed = 0;
    for (const { id } of accounts) if (await this.sync(id)) changed++;
    return changed;
  }

  /** Operations deleting the account's manual-holding mirror; run inside the caller's `$transaction`. */
  removalOps(accountId: string): Prisma.PrismaPromise<unknown>[] {
    const securityId = manualHoldingSecurityId(accountId);
    return [
      this.prisma.holdingSnapshot.deleteMany({ where: { accountId, securityId } }),
      this.prisma.securityPrice.deleteMany({ where: { securityId } }),
      this.prisma.security.deleteMany({ where: { id: securityId } }),
    ];
  }
}
