import type { PrismaClient } from '@prisma/client';
import type { InvestmentSyncResult, InvestmentStep } from './plaid-investment-sync';

/**
 * Connection status for one investment sync: 'pending' steps are not failures, 'error' ones are.
 * Pending steps are kept so the UI can say it is waiting on the institution.
 */
export function investmentSyncStatus(result: InvestmentSyncResult): {
  lastSyncStatus: 'success' | 'error';
  lastSyncError: string | null;
  pendingSteps: string | null;
} {
  const steps = Object.keys(result.steps) as InvestmentStep[];
  const failed = steps.filter((step) => result.steps[step] === 'error');
  const pending = steps.filter((step) => result.steps[step] === 'pending');
  return {
    lastSyncStatus: failed.length ? 'error' : 'success',
    lastSyncError: failed.length
      ? failed.map((step) => `${step}: ${result.errors[step] ?? 'failed'}`).join('; ')
      : null,
    pendingSteps: pending.length ? pending.join(',') : null,
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
