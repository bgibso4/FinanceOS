import type { PrismaClient } from '@prisma/client';
import type { InvestmentSyncResult, InvestmentStep } from './plaid-investment-sync';

/** Connection status for one investment sync: 'pending' steps are not failures, 'error' ones are. */
export function investmentSyncStatus(result: InvestmentSyncResult): {
  lastSyncStatus: 'success' | 'error';
  lastSyncError: string | null;
} {
  const failed = (Object.keys(result.steps) as InvestmentStep[]).filter(
    (step) => result.steps[step] === 'error'
  );
  if (!failed.length) return { lastSyncStatus: 'success', lastSyncError: null };
  return {
    lastSyncStatus: 'error',
    lastSyncError: failed.map((step) => `${step}: ${result.errors[step] ?? 'failed'}`).join('; '),
  };
}

/** Persist an investment sync's outcome on the account's PlaidConnection. */
export async function recordInvestmentSyncStatus(
  prisma: PrismaClient,
  result: InvestmentSyncResult
): Promise<void> {
  await prisma.plaidConnection.update({
    where: { accountId: result.accountId },
    data: { lastSyncAt: new Date(), ...investmentSyncStatus(result) },
  });
}
