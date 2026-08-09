import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { POST } from '@/app/api/bank-accounts/adopt/route';

function adoptRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/bank-accounts/adopt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('bank-accounts adopt API', () => {
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

  async function seedTellerEnrollment() {
    return prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_1',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });
  }

  it('creates an account and a teller connection', async () => {
    const enrollment = await seedTellerEnrollment();

    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: enrollment.id,
        externalAccountId: 'acc_new_card',
        name: 'Amazon Prime Card',
        type: 'credit',
        subtype: 'credit_card',
        lastFour: '4242',
        providerName: 'AMEX PRIME CARD',
        providerType: 'credit',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account.name).toBe('Amazon Prime Card');
    expect(body.account.type).toBe('credit');
    expect(body.account.institution).toBe('Chase');
    expect(body.account.trackingMode).toBe('cash_flow');

    const connection = await prisma.tellerConnection.findUnique({
      where: { accountId: body.account.id },
    });
    expect(connection?.tellerAccountId).toBe('acc_new_card');
    expect(connection?.tellerEnrollmentId).toBe(enrollment.id);
    // Provider columns store the PROVIDER's raw values, not the FinanceOS ones.
    expect(connection?.tellerAccountName).toBe('AMEX PRIME CARD');
    expect(connection?.tellerAccountType).toBe('credit');
  });

  it('stores the raw provider type in the connection while the account gets the mapped FinanceOS type', async () => {
    // Regression guard: Teller's raw vocabulary ('depository') differs from the
    // FinanceOS type ('checking') the user picks in the adopt modal. Tier 4 of
    // matchConnectionsToAccounts compares conn.type === acc.type using the RAW
    // provider type, so storing the FinanceOS type here would make an adopted
    // checking account permanently unmatchable on a future re-adopt.
    const enrollment = await seedTellerEnrollment();

    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: enrollment.id,
        externalAccountId: 'acc_new_checking',
        name: 'My Checking',
        type: 'checking',
        providerName: 'Chase Total Checking',
        providerType: 'depository',
        subtype: 'checking',
        lastFour: '1234',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account.type).toBe('checking');

    const connection = await prisma.tellerConnection.findUnique({
      where: { accountId: body.account.id },
    });
    expect(connection?.tellerAccountType).toBe('depository');
    expect(connection?.tellerAccountName).toBe('Chase Total Checking');
  });

  it('falls back to name/type for the provider columns when providerName/providerType are omitted', async () => {
    const enrollment = await seedTellerEnrollment();

    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: enrollment.id,
        externalAccountId: 'acc_legacy_caller',
        name: 'Legacy Caller Card',
        type: 'credit',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const connection = await prisma.tellerConnection.findUnique({
      where: { accountId: body.account.id },
    });
    expect(connection?.tellerAccountName).toBe('Legacy Caller Card');
    expect(connection?.tellerAccountType).toBe('credit');
  });

  it('applies the balance_only tracking default for non-cash-flow types', async () => {
    const enrollment = await seedTellerEnrollment();

    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: enrollment.id,
        externalAccountId: 'acc_loan',
        name: 'Auto Loan',
        type: 'loan',
      })
    );
    const body = await res.json();

    expect(body.account.trackingMode).toBe('balance_only');
  });

  it('rejects adopting an account that is already linked', async () => {
    const enrollment = await seedTellerEnrollment();
    const payload = {
      provider: 'teller',
      enrollmentId: enrollment.id,
      externalAccountId: 'acc_dup',
      name: 'Dup Card',
      type: 'credit',
    };

    await POST(adoptRequest(payload));
    const res = await POST(adoptRequest(payload));

    expect(res.status).toBe(409);
    expect(await prisma.account.count()).toBe(1);
  });

  it('returns 404 for an unknown enrollment', async () => {
    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: 'does-not-exist',
        externalAccountId: 'acc_x',
        name: 'Ghost',
        type: 'credit',
      })
    );

    expect(res.status).toBe(404);
    expect(await prisma.account.count()).toBe(0);
  });

  it('creates an account and a plaid connection', async () => {
    const enrollment = await prisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item_1',
        institutionId: 'ins_1',
        institutionName: 'Bilt Rewards',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });

    const res = await POST(
      adoptRequest({
        provider: 'plaid',
        enrollmentId: enrollment.id,
        externalAccountId: 'plaid_acc_1',
        name: 'Bilt Card',
        type: 'credit',
        subtype: 'credit_card',
        lastFour: '9911',
        providerName: 'Bilt Mastercard',
        providerType: 'credit',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const connection = await prisma.plaidConnection.findUnique({
      where: { accountId: body.account.id },
    });
    expect(connection?.plaidAccountId).toBe('plaid_acc_1');
    expect(connection?.plaidAccountName).toBe('Bilt Mastercard');
    expect(connection?.plaidAccountType).toBe('credit');
    expect(connection?.plaidAccountSubtype).toBe('credit_card');
    expect(connection?.plaidAccountMask).toBe('9911');
  });

  it('returns 404 for an unknown enrollment (plaid)', async () => {
    const res = await POST(
      adoptRequest({
        provider: 'plaid',
        enrollmentId: 'does-not-exist',
        externalAccountId: 'plaid_acc_x',
        name: 'Ghost',
        type: 'credit',
      })
    );

    expect(res.status).toBe(404);
    expect(await prisma.account.count()).toBe(0);
  });

  it('rejects a concurrent double-adopt of the same bank account with only one winner', async () => {
    const enrollment = await seedTellerEnrollment();
    const payload = {
      provider: 'teller',
      enrollmentId: enrollment.id,
      externalAccountId: 'acc_race',
      name: 'Race Card',
      type: 'credit',
    };

    const [resA, resB] = await Promise.all([
      POST(adoptRequest(payload)),
      POST(adoptRequest(payload)),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.account.count()).toBe(1);
  });
});
