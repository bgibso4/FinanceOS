import type { Account, AccountBalance, Prisma, PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError, requireInvestmentAccount } from './account-guard';
import { isoDay, utcDay } from './dates';
import { classifyPastBalances, parseDayText, type ParsedLine } from './past-balances';
import {
  BalanceRowSource,
  BalanceSource,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from './codes';

const MANUAL_HOLDING_PREFIX = 'manual-holding-';

export const manualHoldingSecurityId = (accountId: string) =>
  `${MANUAL_HOLDING_PREFIX}${accountId}`;

/** Whether a security is a manual account's balance mirror rather than a real security. */
export const isManualHoldingSecurity = (securityId: string) =>
  securityId.startsWith(MANUAL_HOLDING_PREFIX);

export type EnteredSkipReason =
  | 'already'
  | 'skipped'
  | 'future'
  | 'repeated'
  | 'unreadable'
  | 'kept';

/**
 * Balances the user enters (`manual` rows) on any investment account, dated before the day the
 * account's own source takes over. Manual accounts also mirror them as one synthetic holding.
 */
export class EnteredBalanceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock = systemClock
  ) {}

  /** The server's UTC day, so clients judge "future" the way `record` does. */
  today(): string {
    return isoDay(utcDay(this.clock.now()));
  }

  async list(accountId: string): Promise<{ balances: AccountBalance[]; enterBefore: Date | null }> {
    const account = await requireInvestmentAccount(this.prisma, accountId);
    const [balances, enterBefore] = await Promise.all([
      this.prisma.accountBalance.findMany({
        where: { accountId, source: BalanceRowSource.Manual },
        orderBy: { date: 'desc' },
      }),
      this.enterBefore(account),
    ]);
    return { balances, enterBefore };
  }

  async record(
    accountId: string,
    input: { date: string | Date; balance: number }
  ): Promise<AccountBalance> {
    const account = await requireInvestmentAccount(this.prisma, accountId);
    if (!Number.isFinite(input.balance)) throw new InvestmentInputError('Balance must be a number');
    const date = utcDay(input.date);
    if (date > utcDay(this.clock.now())) {
      throw new InvestmentInputError('Balance date cannot be in the future');
    }
    const enterBefore = await this.enterBefore(account);
    if (enterBefore && date >= enterBefore) {
      throw new InvestmentInputError(
        `Balances you enter must be dated before ${isoDay(enterBefore)}`
      );
    }
    const existing = await this.prisma.accountBalance.findUnique({
      where: { accountId_date: { accountId, date } },
    });
    if (existing && existing.source !== BalanceRowSource.Manual) {
      throw new InvestmentInputError(
        `This day already has a ${existing.source === BalanceRowSource.Synced ? 'synced' : 'valued'} balance`
      );
    }
    const row = await this.upsert(account, date, input.balance);
    if (account.balanceSource === BalanceSource.Manual) await this.sync(accountId);
    return row;
  }

  /**
   * Save many entries at once: the new and changed ones in one transaction. Every other row is
   * reported, in input order, with why it was not saved (`kept`: a synced or valued row holds
   * that day).
   */
  async recordMany(
    accountId: string,
    rows: { date: string; balance: number }[]
  ): Promise<{ saved: number; skipped: { date: string; reason: EnteredSkipReason }[] }> {
    const prisma = this.prisma;
    const account = await requireInvestmentAccount(prisma, accountId);
    const [stored, enterBefore] = await Promise.all([
      prisma.accountBalance.findMany({ where: { accountId } }),
      this.enterBefore(account),
    ]);
    const kept = new Set(
      stored.filter((b) => b.source !== BalanceRowSource.Manual).map((b) => isoDay(b.date))
    );
    const lines = rows.map((r): ParsedLine => {
      const text = `${r.date} ${r.balance}`;
      const date = parseDayText(r.date);
      return date !== null && Number.isFinite(r.balance)
        ? { kind: 'ok', text, date, balance: r.balance }
        : { kind: 'unreadable', text };
    });
    const classified = classifyPastBalances(lines, {
      entered: stored
        .filter((b) => b.source === BalanceRowSource.Manual)
        .map((b) => ({ date: isoDay(b.date), balance: b.balance })),
      enterBefore: enterBefore && isoDay(enterBefore),
      source: account.balanceSource as BalanceSource,
      today: isoDay(utcDay(this.clock.now())),
    });

    const saves: { date: string; balance: number }[] = [];
    const skipped: { date: string; reason: EnteredSkipReason }[] = [];
    classified.forEach(({ line, status, saves: save }, i) => {
      if (save && line.kind === 'ok' && !kept.has(line.date)) {
        saves.push(line);
        return;
      }
      const reason = save ? 'kept' : (status.kind as EnteredSkipReason);
      skipped.push({ date: rows[i].date, reason });
    });
    if (saves.length) {
      await prisma.$transaction(saves.map((r) => this.upsert(account, utcDay(r.date), r.balance)));
      if (account.balanceSource === BalanceSource.Manual) await this.sync(accountId);
    }
    return { saved: saves.length, skipped };
  }

  async delete(accountId: string, balanceId: string): Promise<void> {
    const account = await requireInvestmentAccount(this.prisma, accountId);
    const { count } = await this.prisma.accountBalance.deleteMany({
      where: { id: balanceId, accountId, source: BalanceRowSource.Manual },
    });
    if (!count) throw new InvestmentInputError('Balance entry not found', 404);
    if (account.balanceSource === BalanceSource.Manual) await this.sync(accountId);
  }

  /**
   * Make the mirror security's snapshots exactly one per manual balance entry, plus one at the
   * latest stored balance (any source) when it is newer than the newest entry. Real holdings are
   * never touched. Returns false (and writes nothing) when the mirror already matches.
   */
  async sync(accountId: string): Promise<boolean> {
    const prisma = this.prisma;
    const account = await requireInvestmentAccount(prisma, accountId, BalanceSource.Manual);
    const securityId = manualHoldingSecurityId(accountId);
    const [entered, latest, snapshots] = await Promise.all([
      prisma.accountBalance.findMany({
        where: { accountId, source: BalanceRowSource.Manual },
        orderBy: { date: 'asc' },
      }),
      prisma.accountBalance.findFirst({ where: { accountId }, orderBy: { date: 'desc' } }),
      prisma.holdingSnapshot.findMany({
        where: { accountId, securityId },
        orderBy: { date: 'asc' },
      }),
    ]);
    const newest = entered.at(-1);
    const balances =
      latest && (!newest || latest.date > newest.date) ? [...entered, latest] : entered;
    const inSync =
      snapshots.length === balances.length &&
      balances.every(
        (b, i) =>
          snapshots[i].date.getTime() === b.date.getTime() && snapshots[i].value === b.balance
      );
    if (inSync) return false;

    await prisma.security.upsert({
      where: { id: securityId },
      create: {
        id: securityId,
        name: account.name,
        type: SecurityType.Other,
        currency: account.currency,
        pricing: Pricing.Manual,
      },
      update: { name: account.name, currency: account.currency },
    });
    await prisma.$transaction([
      prisma.holdingSnapshot.deleteMany({ where: { accountId, securityId } }),
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
            source: RecordSource.Manual,
          },
        }),
        prisma.securityPrice.create({
          data: { securityId, date: b.date, close: b.balance, source: PriceSource.Manual },
        }),
      ]),
    ]);
    return true;
  }

  /**
   * Change the account's balance source, keeping every stored balance and holding. Switching to
   * Manual writes the mirror from the entered and latest stored balances. The caller checks the
   * switch is allowed (`checkAccountUpdate`) and holds the refresh lock.
   */
  async switchSource(accountId: string, to: BalanceSource): Promise<void> {
    await requireInvestmentAccount(this.prisma, accountId);
    await this.prisma.account.update({ where: { id: accountId }, data: { balanceSource: to } });
    if (to === BalanceSource.Manual) await this.sync(accountId);
  }

  async syncAll(): Promise<number> {
    const accounts = await this.prisma.account.findMany({
      where: { trackingMode: 'investment', balanceSource: BalanceSource.Manual },
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

  private upsert(account: Account, date: Date, balance: number) {
    return this.prisma.accountBalance.upsert({
      where: { accountId_date: { accountId: account.id, date } },
      create: {
        accountId: account.id,
        date,
        balance,
        currency: account.currency,
        source: BalanceRowSource.Manual,
      },
      update: { balance, source: BalanceRowSource.Manual },
    });
  }

  /**
   * The first day the account's own source owns; entered balances must be dated before it.
   * Synced: the first synced balance or holdings day. Valued: the first real holdings day.
   * Either is today while there is none. Manual: no cutoff.
   */
  private async enterBefore(account: Account): Promise<Date | null> {
    const prisma = this.prisma;
    const accountId = account.id;
    if (account.balanceSource === BalanceSource.Manual) return null;
    const firstDay = { orderBy: { date: 'asc' }, select: { date: true } } as const;
    const firsts =
      account.balanceSource === BalanceSource.Valuation
        ? [
            await prisma.holdingSnapshot.findFirst({
              where: { accountId, securityId: { not: manualHoldingSecurityId(accountId) } },
              ...firstDay,
            }),
          ]
        : await Promise.all([
            prisma.accountBalance.findFirst({
              where: { accountId, source: BalanceRowSource.Synced },
              ...firstDay,
            }),
            prisma.holdingSnapshot.findFirst({
              where: { accountId, source: RecordSource.Synced },
              ...firstDay,
            }),
          ]);
    const days = firsts.flatMap((f) => (f ? [f.date.getTime()] : []));
    return days.length ? new Date(Math.min(...days)) : utcDay(this.clock.now());
  }
}
