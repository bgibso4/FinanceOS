import type { PrismaClient } from '@prisma/client';
import { addDays } from './dates';

export const LINK_WINDOW_DAYS = 5;
const AMOUNT_EPSILON = 0.005;
const DAY_MS = 24 * 60 * 60 * 1000;
const CASH_FLOW_SUBTYPES = new Set([
  'deposit',
  'withdrawal',
  'contribution',
  'transfer',
  'transfer_in',
  'transfer_out',
]);

export function isCashFlow(t: { type: string; subtype: string }): boolean {
  return t.type === 'transfer' || (t.type === 'cash' && CASH_FLOW_SUBTYPES.has(t.subtype));
}

export function pickMatch(
  inv: { date: Date; amount: number },
  candidates: { id: string; date: Date; amount: number }[]
): string | null {
  const hits = candidates.filter(
    (c) =>
      Math.abs(c.amount - inv.amount) <= AMOUNT_EPSILON &&
      Math.abs(c.date.getTime() - inv.date.getTime()) <= LINK_WINDOW_DAYS * DAY_MS
  );
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Link unlinked investment cash flows (deposits/withdrawals/transfers) in the given accounts to
 * a bank Transaction with the same signed amount within ±5 days. Both sign conventions make a
 * bank→brokerage deposit negative on both sides, so amounts must be equal, not opposite.
 */
export async function linkInvestmentTransfers(
  prisma: PrismaClient,
  accountIds: string[]
): Promise<number> {
  const pending = await prisma.investmentTransaction.findMany({
    where: { accountId: { in: accountIds }, isCancelled: false, linkedTransactionId: null },
    orderBy: { date: 'asc' },
  });
  let linked = 0;
  for (const inv of pending.filter(isCashFlow)) {
    const candidates = await prisma.transaction.findMany({
      where: {
        date: {
          gte: addDays(inv.date, -LINK_WINDOW_DAYS),
          lte: addDays(inv.date, LINK_WINDOW_DAYS),
        },
        amount: { gte: inv.amount - AMOUNT_EPSILON, lte: inv.amount + AMOUNT_EPSILON },
        isSplitParent: false,
        investmentLinks: { none: {} },
        account: { trackingMode: { not: 'investment' } },
      },
      select: { id: true, date: true, amount: true },
    });
    const match = pickMatch(inv, candidates);
    if (!match) continue;
    await prisma.$transaction([
      prisma.investmentTransaction.update({
        where: { id: inv.id },
        data: { linkedTransactionId: match },
      }),
      prisma.transaction.update({ where: { id: match }, data: { isTransfer: true } }),
    ]);
    linked++;
  }
  return linked;
}
