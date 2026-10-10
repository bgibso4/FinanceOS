import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/investments/plaid-investment-sync', () => ({ syncPlaidInvestments: vi.fn() }));
vi.mock('@/lib/plaid-sync', () => ({ syncPlaidTransactions: vi.fn() }));

import { POST } from '@/app/api/plaid/sync/route';
import { syncPlaidInvestments } from '@/lib/investments/plaid-investment-sync';
import { syncPlaidTransactions } from '@/lib/plaid-sync';

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/plaid/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

describe('POST /api/plaid/sync for investment accounts', () => {
  let accountId: string;
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
    const a = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'provider',
      },
    });
    accountId = a.id;
    const e = await testPrisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item-1',
        institutionName: 'Test Brokerage',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
      },
    });
    await testPrisma.plaidConnection.create({
      data: {
        accountId,
        plaidEnrollmentId: e.id,
        plaidAccountId: 'pa-1',
        plaidAccountType: 'investment',
      },
    });
  });

  it('calls the investment sync, not the transaction sync, and records status', async () => {
    vi.mocked(syncPlaidInvestments).mockResolvedValue({
      accountId,
      steps: { balance: 'ok', holdings: 'ok', transactions: 'ok', linking: 'ok' },
      errors: {},
      counts: { holdings: 1, transactions: 2, cancelled: 0, linked: 0 },
    });
    const body = await (await post({ accountId })).json();
    expect(body).toMatchObject({ success: true, investment: true, counts: { transactions: 2 } });
    expect(syncPlaidTransactions).not.toHaveBeenCalled();
    const conn = await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } });
    expect(conn.lastSyncStatus).toBe('success');
    expect(conn.lastSyncAt).not.toBeNull();
  });

  it('records partial failures as an error status with the step messages', async () => {
    vi.mocked(syncPlaidInvestments).mockResolvedValue({
      accountId,
      steps: { balance: 'ok', holdings: 'error', transactions: 'ok', linking: 'ok' },
      errors: { holdings: 'boom' },
      counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
    });
    await post({ accountId });
    const conn = await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } });
    expect(conn.lastSyncStatus).toBe('error');
    expect(conn.lastSyncError).toContain('holdings: boom');
  });

  it('marks the connection for re-auth on ITEM_LOGIN_REQUIRED', async () => {
    vi.mocked(syncPlaidInvestments).mockRejectedValue(
      Object.assign(new Error('login'), {
        response: { data: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' } },
      })
    );
    const res = await post({ accountId });
    expect(res.status).toBe(400);
    expect(
      (await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } })).status
    ).toBe('needs_reauth');
  });
});
