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

import { PATCH } from '@/app/api/accounts/[id]/route';

describe('investment schema', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('stores balance history, securities, snapshots and investment transactions', async () => {
    const account = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'provider',
      },
    });
    const day = new Date('2026-10-09T00:00:00.000Z');
    await testPrisma.accountBalance.create({
      data: { accountId: account.id, date: day, balance: 1000, currency: 'USD', source: 'plaid' },
    });
    const security = await testPrisma.security.create({
      data: {
        name: 'Test ETF',
        ticker: 'TETF',
        type: 'etf',
        currency: 'USD',
        pricing: 'feed',
        priceSymbol: 'TETF',
      },
    });
    await testPrisma.holdingSnapshot.create({
      data: {
        accountId: account.id,
        securityId: security.id,
        date: day,
        quantity: 2,
        price: 500,
        value: 1000,
        source: 'plaid',
      },
    });
    await testPrisma.investmentTransaction.create({
      data: {
        accountId: account.id,
        securityId: security.id,
        externalId: 'inv-1',
        date: day,
        type: 'buy',
        subtype: 'buy',
        name: 'BUY TETF',
        quantity: 2,
        price: 500,
        amount: 1000,
        currency: 'USD',
        source: 'plaid',
      },
    });

    await expect(
      testPrisma.accountBalance.create({
        data: { accountId: account.id, date: day, balance: 1, currency: 'USD', source: 'plaid' },
      })
    ).rejects.toThrow(); // unique (accountId, date)

    await testPrisma.account.delete({ where: { id: account.id } });
    expect(await testPrisma.accountBalance.count()).toBe(0); // cascades
    expect(await testPrisma.holdingSnapshot.count()).toBe(0);
    expect(await testPrisma.investmentTransaction.count()).toBe(0);
  });

  it('PATCH accepts trackingMode investment with a balanceSource', async () => {
    const account = await testPrisma.account.create({
      data: createAccountData({ type: 'brokerage' }),
    });
    const req = new NextRequest(`http://localhost/api/accounts/${account.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ trackingMode: 'investment', balanceSource: 'manual' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: account.id }) });
    const body = await res.json();
    expect(body.trackingMode).toBe('investment');
    expect(body.balanceSource).toBe('manual');
  });
});
