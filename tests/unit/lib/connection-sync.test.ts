import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/plaid-sync', () => ({ syncPlaidTransactions: vi.fn() }));
vi.mock('@/lib/teller-sync', () => ({ syncTellerTransactions: vi.fn() }));

import {
  syncPlaidConnection,
  syncTellerConnection,
  ConnectionSyncError,
} from '@/lib/connection-sync';
import { syncPlaidTransactions } from '@/lib/plaid-sync';
import { syncTellerTransactions } from '@/lib/teller-sync';

describe('connection-sync re-login status', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
  });

  it('plaidReauthIsRecordedByTheLibrary', async () => {
    const a = await testPrisma.account.create({ data: createAccountData({ type: 'checking' }) });
    const e = await testPrisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item-1',
        institutionName: 'Bank',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
      },
    });
    await testPrisma.plaidConnection.create({
      data: {
        accountId: a.id,
        plaidEnrollmentId: e.id,
        plaidAccountId: 'pa-1',
        plaidAccountType: 'depository',
      },
    });
    vi.mocked(syncPlaidTransactions).mockRejectedValue({
      response: { data: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' } },
    });

    const err = await syncPlaidConnection(a.id, { daysToSync: 30 }).catch((x) => x);
    expect(err).toBeInstanceOf(ConnectionSyncError);
    expect(err).toMatchObject({
      code: 'NEEDS_REAUTH',
      status: 400,
      message: 'Bank login required',
    });
    const row = await testPrisma.plaidConnection.findUnique({ where: { accountId: a.id } });
    expect(row?.status).toBe('needs_reauth');

    // A second call is refused up front.
    await expect(syncPlaidConnection(a.id, { daysToSync: 30 })).rejects.toMatchObject({
      code: 'NEEDS_REAUTH',
      message: 'Account requires re-authentication',
    });
  });

  it('tellerReauthIsRecordedByTheLibrary', async () => {
    const a = await testPrisma.account.create({ data: createAccountData({ type: 'checking' }) });
    const e = await testPrisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'te-1',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
        status: 'active',
      },
    });
    await testPrisma.tellerConnection.create({
      data: {
        accountId: a.id,
        tellerEnrollmentId: e.id,
        tellerAccountId: 'ta-1',
        status: 'active',
      },
    });
    vi.mocked(syncTellerTransactions).mockRejectedValue(new Error('Enrollment is not healthy'));

    const err = await syncTellerConnection(a.id, { daysToSync: 30 }).catch((x) => x);
    expect(err).toBeInstanceOf(ConnectionSyncError);
    expect(err).toMatchObject({ code: 'AUTH_EXPIRED', status: 400 });
    const row = await testPrisma.tellerConnection.findUnique({ where: { accountId: a.id } });
    expect(row?.status).toBe('disconnected');
    const enr = await testPrisma.tellerEnrollment.findUnique({ where: { id: e.id } });
    expect(enr?.status).toBe('disconnected');

    await expect(syncTellerConnection(a.id, { daysToSync: 30 })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
  });

  it('reports a missing connection as NOT_FOUND', async () => {
    await expect(syncTellerConnection('nope', { daysToSync: 30 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
