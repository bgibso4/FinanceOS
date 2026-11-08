import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import { writePassRecord } from '@/lib/scheduled-sync/record';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

describe('GET /api/scheduled-sync/status', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.unstubAllEnvs();
  });

  it('offWhenDisabled', async () => {
    const { GET } = await import('@/app/api/scheduled-sync/status/route');
    const body = await (await GET()).json();
    expect(body).toEqual({
      enabled: false,
      lastFinishedAt: null,
      nextAround: null,
      failedSteps: [],
      needsAttention: false,
    });
  });

  it('reportsLastPassAndEnabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await writePassRecord(testPrisma, {
      finishedAt: new Date('2026-11-08T08:00:00Z'),
      failures: [],
      units: [],
    });
    const { GET } = await import('@/app/api/scheduled-sync/status/route');
    const body = await (await GET()).json();
    expect(body.enabled).toBe(true);
    expect(body.lastFinishedAt).toBe('2026-11-08T08:00:00.000Z');
    expect(body.nextAround).toBe('2026-11-08T12:00:00.000Z');
    expect(body.needsAttention).toBe(false);
  });

  it('reportsNeedsAttention', async () => {
    const { GET } = await import('@/app/api/scheduled-sync/status/route');
    await writePassRecord(testPrisma, {
      finishedAt: new Date('2026-11-08T08:00:00Z'),
      failures: ['prices'],
      units: [],
    });
    expect((await (await GET()).json()).needsAttention).toBe(true);

    await writePassRecord(testPrisma, {
      finishedAt: new Date('2026-11-08T08:00:00Z'),
      failures: [],
      units: [],
    });
    const a = await testPrisma.account.create({ data: createAccountData({ type: 'checking' }) });
    const e = await testPrisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'te-1',
        institutionId: 'x',
        institutionName: 'X',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
      },
    });
    await testPrisma.tellerConnection.create({
      data: {
        accountId: a.id,
        tellerEnrollmentId: e.id,
        tellerAccountId: 't1',
        status: 'disconnected',
      },
    });
    expect((await (await GET()).json()).needsAttention).toBe(true);
  });

  // The pass skips inactive accounts and Ben never reconnects a closed one, so its dead
  // connection must not hold the dot up forever.
  it('ignoresDeadConnectionsOnInactiveAccounts', async () => {
    const { GET } = await import('@/app/api/scheduled-sync/status/route');
    const teller = await testPrisma.account.create({
      data: createAccountData({ type: 'checking', isActive: false }),
    });
    const te = await testPrisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'te-closed',
        institutionId: 'x',
        institutionName: 'X',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
      },
    });
    await testPrisma.tellerConnection.create({
      data: {
        accountId: teller.id,
        tellerEnrollmentId: te.id,
        tellerAccountId: 't-closed',
        status: 'disconnected',
      },
    });
    const plaid = await testPrisma.account.create({
      data: createAccountData({ type: 'checking', isActive: false }),
    });
    const pe = await testPrisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item-closed',
        institutionName: 'Bank',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
      },
    });
    await testPrisma.plaidConnection.create({
      data: {
        accountId: plaid.id,
        plaidEnrollmentId: pe.id,
        plaidAccountId: 'pa-closed',
        plaidAccountType: 'depository',
        status: 'needs_reauth',
      },
    });
    expect((await (await GET()).json()).needsAttention).toBe(false);

    await testPrisma.account.update({ where: { id: plaid.id }, data: { isActive: true } });
    expect((await (await GET()).json()).needsAttention).toBe(true);
  });
});
