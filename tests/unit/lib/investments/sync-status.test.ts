import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { seedInvestmentAccount, seedPlaidConnection } from '../../../helpers/investments';
import { investmentSyncStatus, recordInvestmentSyncStatus } from '@/lib/investments/sync-status';
import type { InvestmentSyncResult } from '@/lib/investments/plaid-investment-sync';

const result = (
  steps: Partial<InvestmentSyncResult['steps']>,
  errors: InvestmentSyncResult['errors'] = {},
  accountId = 'a'
): InvestmentSyncResult => ({
  accountId,
  steps: { balance: 'ok', holdings: 'ok', transactions: 'ok', linking: 'ok', ...steps },
  errors,
  counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
});

describe('investmentSyncStatus', () => {
  it('is success when every step is ok, skipped or pending', () => {
    expect(
      investmentSyncStatus(result({ holdings: 'pending' }, { holdings: 'not ready' }))
    ).toEqual({ lastSyncStatus: 'success', lastSyncError: null, pendingSteps: 'holdings' });
  });

  it('is error with the failed steps when any step errored', () => {
    expect(
      investmentSyncStatus(
        result(
          { holdings: 'error', transactions: 'pending' },
          { holdings: 'boom', transactions: 'not ready' }
        )
      )
    ).toEqual({
      lastSyncStatus: 'error',
      lastSyncError: 'holdings: boom',
      pendingSteps: 'transactions',
    });
  });

  it('has no pending steps when nothing is pending', () => {
    expect(investmentSyncStatus(result({})).pendingSteps).toBeNull();
  });
});

describe('recordInvestmentSyncStatus', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('persists pending steps, and clears them once the institution is ready', async () => {
    const a = await seedInvestmentAccount(prisma);
    await seedPlaidConnection(prisma, a.id);
    await recordInvestmentSyncStatus(
      prisma,
      result({ holdings: 'pending', transactions: 'pending' }, {}, a.id)
    );
    expect(await prisma.plaidConnection.findUnique({ where: { accountId: a.id } })).toMatchObject({
      lastSyncStatus: 'success',
      pendingSteps: 'holdings,transactions',
    });
    await recordInvestmentSyncStatus(prisma, result({}, {}, a.id));
    expect(
      (await prisma.plaidConnection.findUnique({ where: { accountId: a.id } }))?.pendingSteps
    ).toBeNull();
  });
});
