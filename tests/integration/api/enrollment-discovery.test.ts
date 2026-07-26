import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

vi.mock('@/lib/teller', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/teller')>();
  return { ...original, tellerFetch: vi.fn() };
});

vi.mock('@/lib/encryption', () => ({
  encryptAccessToken: vi.fn(() => ({ encrypted: 'enc', iv: 'iv' })),
  decryptAccessToken: vi.fn(() => 'decrypted'),
}));

import { GET } from '@/app/api/teller/enrollment/route';
import { tellerFetch } from '@/lib/teller';

function tellerAccount(id: string, lastFour: string, name: string) {
  return {
    id,
    enrollment_id: 'enr_1',
    institution: { id: 'chase', name: 'Chase' },
    name,
    type: 'depository',
    subtype: 'checking',
    currency: 'USD',
    last_four: lastFour,
    status: 'open',
  };
}

describe('teller enrollment GET discovery', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    testPrisma = prisma;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
  });

  async function seed() {
    const enrollment = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_1',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });
    const account = await prisma.account.create({
      data: createAccountData({ name: 'Personal Checking' }),
    });
    await prisma.tellerConnection.create({
      data: {
        accountId: account.id,
        tellerEnrollmentId: enrollment.id,
        tellerAccountId: 'acc_linked',
        tellerAccountName: 'Personal Checking',
        tellerAccountLastFour: '3857',
        status: 'connected',
      },
    });
    return enrollment;
  }

  it('excludes linked accounts from availableAccounts but counts them in the total', async () => {
    await seed();
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_linked', '3857', 'Personal Checking'),
      tellerAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    const body = await (await GET()).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.totalAccountCount).toBe(2);
    expect(enrollment.availableAccounts).toHaveLength(1);
    expect(enrollment.availableAccounts[0].externalId).toBe('acc_new');
    expect(enrollment.hiddenAccounts).toHaveLength(0);
  });

  it('moves ignored accounts into hiddenAccounts', async () => {
    await seed();
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_new',
        lastFour: '4242',
      },
    });
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_linked', '3857', 'Personal Checking'),
      tellerAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    const body = await (await GET()).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.availableAccounts).toHaveLength(0);
    expect(enrollment.hiddenAccounts.map((a: { externalId: string }) => a.externalId)).toEqual([
      'acc_new',
    ]);
  });

  it('keeps an account hidden after its external id changes, via last four', async () => {
    await seed();
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_stale_id',
        lastFour: '4242',
      },
    });
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_reissued', '4242', 'Amazon Card'),
    ]);

    const body = await (await GET()).json();

    expect(body.enrollments[0].availableAccounts).toHaveLength(0);
    expect(body.enrollments[0].hiddenAccounts).toHaveLength(1);
  });
});
