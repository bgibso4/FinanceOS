import type { Account, PrismaClient } from '@prisma/client';
import type { BalanceSource } from './codes';

export class InvestmentInputError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = 'InvestmentInputError';
    this.status = status;
  }
}

export async function requireInvestmentAccount(
  prisma: PrismaClient,
  accountId: string,
  balanceSource: typeof BalanceSource.Valuation | typeof BalanceSource.Manual
): Promise<Account> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new InvestmentInputError('Account not found', 404);
  if (account.trackingMode !== 'investment' || account.balanceSource !== balanceSource) {
    throw new InvestmentInputError(`Account is not a ${balanceSource} investment account`);
  }
  return account;
}
