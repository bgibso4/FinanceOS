import type { PrismaClient } from '@prisma/client';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

export type ResolvedBalance = {
  balance: number;
  asOf: Date | null;
  source: 'transactions' | BalanceRowSource;
};

/** The source an investment account reports before it has any balance row. */
const SOURCE_FOR_EMPTY: Record<BalanceSource, BalanceRowSource> = {
  [BalanceSource.Provider]: BalanceRowSource.Synced,
  [BalanceSource.Valuation]: BalanceRowSource.Valuation,
  [BalanceSource.Manual]: BalanceRowSource.Manual,
};

/**
 * Resolve native-currency balances. Investment accounts read their latest AccountBalance row
 * (their Transaction rows, if any, are ignored); every other account sums its transactions,
 * excluding split parents (their parts carry the amounts).
 */
export async function getAccountBalances(
  prisma: PrismaClient,
  accounts: { id: string; trackingMode: string }[]
): Promise<Map<string, ResolvedBalance>> {
  const result = new Map<string, ResolvedBalance>();
  const investmentIds = accounts.filter((a) => a.trackingMode === 'investment').map((a) => a.id);
  const ledgerIds = accounts.filter((a) => a.trackingMode !== 'investment').map((a) => a.id);

  if (ledgerIds.length) {
    const sums = await prisma.transaction.groupBy({
      by: ['accountId'],
      _sum: { amount: true },
      where: { accountId: { in: ledgerIds }, isSplitParent: false },
    });
    const byId = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
    for (const id of ledgerIds) {
      result.set(id, { balance: byId.get(id) ?? 0, asOf: null, source: 'transactions' });
    }
  }

  if (investmentIds.length) {
    const latest = await prisma.accountBalance.findMany({
      where: { accountId: { in: investmentIds } },
      orderBy: { date: 'desc' },
      distinct: ['accountId'],
    });
    const byId = new Map(latest.map((r) => [r.accountId, r]));
    const meta = await prisma.account.findMany({
      where: { id: { in: investmentIds } },
      select: { id: true, balanceSource: true },
    });
    for (const { id, balanceSource } of meta) {
      const row = byId.get(id);
      result.set(
        id,
        row
          ? {
              balance: row.balance,
              asOf: row.date,
              source: row.source as ResolvedBalance['source'],
            }
          : {
              balance: 0,
              asOf: null,
              source:
                SOURCE_FOR_EMPTY[(balanceSource ?? BalanceSource.Manual) as BalanceSource] ??
                BalanceRowSource.Manual,
            }
      );
    }
  }

  return result;
}

export async function getAccountBalance(
  prisma: PrismaClient,
  accountId: string
): Promise<ResolvedBalance> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { id: true, trackingMode: true },
  });
  const map = await getAccountBalances(prisma, [account]);
  return map.get(accountId)!;
}
