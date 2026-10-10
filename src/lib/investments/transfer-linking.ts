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

type Datable = { date: Date; amount: number };

function sameMoveWithinWindow(a: Datable, b: Datable): boolean {
  return (
    Math.abs(a.amount - b.amount) <= AMOUNT_EPSILON &&
    Math.abs(a.date.getTime() - b.date.getTime()) <= LINK_WINDOW_DAYS * DAY_MS
  );
}

export function pickMatch(
  inv: { date: Date; amount: number },
  candidates: { id: string; date: Date; amount: number }[]
): string | null {
  const hits = candidates.filter((c) => sameMoveWithinWindow(c, inv));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Link unlinked investment cash flows (deposits/withdrawals/transfers) in the given accounts to
 * a bank Transaction with the same signed amount within ±5 days. Both sign conventions make a
 * bank→brokerage deposit negative on both sides, so amounts must be equal, not opposite.
 *
 * A link needs a unique match in both directions: the investment row must have exactly one bank
 * candidate, and that bank row must match no other unlinked cash flow in ANY investment account
 * (e.g. a deposit and a same-amount conversion into another account days later). Bank rows
 * already paired by bank↔bank transfer detection are not candidates.
 */
export async function linkInvestmentTransfers(
  prisma: PrismaClient,
  accountIds: string[]
): Promise<number> {
  const unlinked = (
    await prisma.investmentTransaction.findMany({
      where: {
        isCancelled: false,
        linkedTransactionId: null,
        account: { trackingMode: 'investment' },
      },
      orderBy: { date: 'asc' },
    })
  ).filter(isCashFlow);
  const requested = new Set(accountIds);
  const open = new Set(unlinked.map((t) => t.id));
  let linked = 0;
  for (const inv of unlinked) {
    if (!requested.has(inv.accountId)) continue;
    const candidates = await prisma.transaction.findMany({
      where: {
        date: {
          gte: addDays(inv.date, -LINK_WINDOW_DAYS),
          lte: addDays(inv.date, LINK_WINDOW_DAYS),
        },
        amount: { gte: inv.amount - AMOUNT_EPSILON, lte: inv.amount + AMOUNT_EPSILON },
        isSplitParent: false,
        transferGroupId: null,
        investmentLinks: { none: {} },
        account: { trackingMode: { not: 'investment' } },
      },
      select: { id: true, date: true, amount: true },
    });
    const match = pickMatch(inv, candidates);
    if (!match) continue;
    const bankRow = candidates.find((c) => c.id === match)!;
    const rivals = unlinked.filter(
      (o) => o.id !== inv.id && open.has(o.id) && sameMoveWithinWindow(o, bankRow)
    );
    if (rivals.length) continue;
    await prisma.$transaction([
      prisma.investmentTransaction.update({
        where: { id: inv.id },
        data: { linkedTransactionId: match },
      }),
      prisma.transaction.update({ where: { id: match }, data: { isTransfer: true } }),
    ]);
    open.delete(inv.id);
    linked++;
  }
  return linked;
}

/**
 * Bank-side retry (spec §4.5: linking is retried on later syncs of either side). Runs linking
 * over every investment-mode account; a failure is logged and never fails the bank sync.
 */
export async function relinkInvestmentTransfers(prisma: PrismaClient): Promise<void> {
  try {
    const accounts = await prisma.account.findMany({
      where: { trackingMode: 'investment' },
      select: { id: true },
    });
    if (!accounts.length) return;
    await linkInvestmentTransfers(
      prisma,
      accounts.map((a) => a.id)
    );
  } catch (error) {
    console.error('[investments] transfer linking after bank sync failed:', error);
  }
}
