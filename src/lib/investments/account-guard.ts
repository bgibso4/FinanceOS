import type { Account, PrismaClient } from '@prisma/client';
import type { TrackingMode } from '@/lib/account-defaults';
import { BalanceSource } from './codes';

const INVESTMENT: TrackingMode = 'investment';

export class InvestmentInputError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = 'InvestmentInputError';
    this.status = status;
  }
}

/** The investment account `accountId`; with `balanceSource`, only one whose balance comes from it. */
export async function requireInvestmentAccount(
  prisma: PrismaClient,
  accountId: string,
  balanceSource?: BalanceSource
): Promise<Account> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new InvestmentInputError('Account not found', 404);
  if (account.trackingMode !== 'investment') {
    throw new InvestmentInputError('Account is not an investment account');
  }
  if (balanceSource && account.balanceSource !== balanceSource) {
    throw new InvestmentInputError(`Account is not a ${balanceSource} investment account`);
  }
  return account;
}

/**
 * Whether an account update may change its tracking mode and balance source. An account never
 * converts to or from an investment account; an investment account always has a source; Synced
 * needs, and is locked by, a connection that syncs its balances (`ctx.synced`). An unchanged
 * value is not a change. Returns the source to switch to, or null when it stays.
 */
export function checkAccountUpdate(
  current: { trackingMode: string; balanceSource: string | null },
  update: { trackingMode?: string; balanceSource?: BalanceSource | null },
  ctx: { synced: boolean }
): { switchTo: BalanceSource | null } {
  const wasInvestment = current.trackingMode === INVESTMENT;
  const isInvestment = (update.trackingMode ?? current.trackingMode) === INVESTMENT;
  if (wasInvestment !== isInvestment) {
    throw new InvestmentInputError(
      'An account can’t be converted to or from an investment account'
    );
  }
  const to = update.balanceSource;
  if (to === undefined || to === current.balanceSource) return { switchTo: null };
  if (!isInvestment) {
    throw new InvestmentInputError('Only investment accounts have a balance source');
  }
  if (to === null) throw new InvestmentInputError('An investment account needs a balance source');
  if (to === BalanceSource.Provider && !ctx.synced) {
    throw new InvestmentInputError('Synced needs a connection to this account’s institution.');
  }
  if (current.balanceSource === BalanceSource.Provider && ctx.synced) {
    throw new InvestmentInputError('Disconnect to value it or enter balances yourself.');
  }
  return { switchTo: to };
}
