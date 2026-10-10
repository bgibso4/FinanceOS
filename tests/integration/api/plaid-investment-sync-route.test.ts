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
  let enrollmentId: string;
  const okResult = (id: string) => ({
    accountId: id,
    steps: { balance: 'ok', holdings: 'ok', transactions: 'ok', linking: 'ok' } as const,
    errors: {},
    counts: { holdings: 1, transactions: 2, cancelled: 0, linked: 0 },
  });
  const addAccount = async (trackingMode: 'investment' | 'cash_flow', plaidAccountId: string) => {
    const a = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: trackingMode === 'investment' ? 'brokerage' : 'checking' }),
        trackingMode,
        balanceSource: trackingMode === 'investment' ? 'provider' : null,
      },
    });
    await testPrisma.plaidConnection.create({
      data: {
        accountId: a.id,
        plaidEnrollmentId: enrollmentId,
        plaidAccountId,
        plaidAccountType: trackingMode === 'investment' ? 'investment' : 'depository',
      },
    });
    return a.id;
  };
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
    enrollmentId = e.id;
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
    expect(body).toMatchObject({
      success: true,
      investment: true,
      added: 0,
      investments: [{ accountId, counts: { transactions: 2 } }],
    });
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

  it('treats pending steps as a successful sync', async () => {
    vi.mocked(syncPlaidInvestments).mockResolvedValue({
      ...okResult(accountId),
      steps: { balance: 'ok', holdings: 'pending', transactions: 'ok', linking: 'ok' },
      errors: { holdings: 'not ready' },
    });
    await post({ accountId });
    const conn = await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } });
    expect(conn.lastSyncStatus).toBe('success');
    expect(conn.lastSyncError).toBeNull();
  });

  it('answers a dry run with zeroed stats and flags the investment account', async () => {
    const res = await post({ accountId, dryRun: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toMatchObject({ added: 0, merged: 0, skippedDuplicates: 0 });
    expect(body.stats.byAccount).toEqual([
      expect.objectContaining({ accountId, added: 0, merged: 0, skippedDuplicates: 0 }),
    ]);
    expect(body.transactions).toEqual([]);
    expect(body.investmentAccountIds).toEqual([accountId]);
    expect(syncPlaidInvestments).not.toHaveBeenCalled();
    expect(syncPlaidTransactions).not.toHaveBeenCalled();
  });

  it('still runs the transaction sync for a cash-flow account', async () => {
    await testPrisma.plaidConnection.deleteMany();
    const bankId = await addAccount('cash_flow', 'pa-bank');
    vi.mocked(syncPlaidTransactions).mockResolvedValue({ added: 3, byAccount: [] } as never);
    const body = await (await post({ accountId: bankId })).json();
    expect(body).toMatchObject({ success: true, added: 3, investments: [] });
    expect(syncPlaidTransactions).toHaveBeenCalledTimes(1);
    expect(syncPlaidInvestments).not.toHaveBeenCalled();
  });

  it('syncs a mixed item: investment sync per investment account, one transaction sync', async () => {
    const bankId = await addAccount('cash_flow', 'pa-bank');
    const secondInvId = await addAccount('investment', 'pa-2');
    vi.mocked(syncPlaidInvestments).mockImplementation(async (c) => okResult(c.accountId));
    vi.mocked(syncPlaidTransactions).mockResolvedValue({ added: 3, byAccount: [] } as never);

    const body = await (await post({ accountId })).json();

    expect(syncPlaidTransactions).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncPlaidTransactions).mock.calls[0][0].accountId).toBe(bankId);
    expect(
      vi
        .mocked(syncPlaidInvestments)
        .mock.calls.map(([c]) => c.accountId)
        .sort()
    ).toEqual([accountId, secondInvId].sort());
    expect(body.added).toBe(3);
    expect(body.investments).toHaveLength(2);
    for (const id of [accountId, secondInvId]) {
      const conn = await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId: id } });
      expect(conn.lastSyncStatus).toBe('success');
    }
  });

  it('previews a mixed item through the transaction sync and lists its investment accounts', async () => {
    const bankId = await addAccount('cash_flow', 'pa-bank');
    vi.mocked(syncPlaidTransactions).mockResolvedValue({
      stats: { added: 1, merged: 0, skippedDuplicates: 0, byAccount: [] },
      transactions: [],
    } as never);
    const body = await (await post({ accountId, dryRun: true })).json();
    expect(vi.mocked(syncPlaidTransactions).mock.calls[0][0].accountId).toBe(bankId);
    expect(body.stats.added).toBe(1);
    expect(body.investmentAccountIds).toEqual([accountId]);
    expect(syncPlaidInvestments).not.toHaveBeenCalled();
  });
});
