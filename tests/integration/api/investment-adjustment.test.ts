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

import { POST } from '@/app/api/transactions/adjustment/route';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/transactions/adjustment', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

describe('adjustment route for investment accounts', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('records a manual AccountBalance instead of a transaction', async () => {
    const a = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'retirement', currency: 'CAD' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Manual,
      },
    });
    await testPrisma.accountBalance.create({
      data: {
        accountId: a.id,
        date: new Date('2026-07-12T00:00:00Z'),
        balance: 1000,
        currency: 'CAD',
        source: BalanceRowSource.Manual,
      },
    });
    const res = await post({ accountId: a.id, amount: 250 });
    expect(res.status).toBe(200);
    expect(await testPrisma.transaction.count({ where: { accountId: a.id } })).toBe(0);
    const rows = await testPrisma.accountBalance.findMany({
      where: { accountId: a.id },
      orderBy: { date: 'desc' },
    });
    expect(rows[0].balance).toBe(1250);
    expect(rows[0].source).toBe(BalanceRowSource.Manual);
    expect(rows[0].currency).toBe('CAD');
  });

  it('reconciling twice on the same day overwrites that day', async () => {
    const a = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'crypto' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Manual,
      },
    });
    await post({ accountId: a.id, amount: 100 });
    await post({ accountId: a.id, amount: 50 });
    const rows = await testPrisma.accountBalance.findMany({ where: { accountId: a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(150);
  });

  it('still creates an adjustment transaction for cash-flow accounts', async () => {
    const a = await testPrisma.account.create({ data: createAccountData() });
    await post({ accountId: a.id, amount: 10 });
    expect(await testPrisma.transaction.count({ where: { accountId: a.id } })).toBe(1);
  });

  it('mirrors a manual reconciliation into the single holding', async () => {
    const account = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'retirement' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Manual,
      },
    });
    const res = await post({ accountId: account.id, amount: 250 });
    expect(res.status).toBe(200);
    expect(await testPrisma.holdingSnapshot.count({ where: { accountId: account.id } })).toBe(1);
  });

  it('rejects reconciling a synced or valued investment account, saying where its balance comes from', async () => {
    const errors = {
      [BalanceSource.Provider]: "This account's balance is set by its connection",
      [BalanceSource.Valuation]: "This account's balance comes from its holdings",
    };
    for (const [balanceSource, error] of Object.entries(errors)) {
      const account = await testPrisma.account.create({
        data: {
          ...createAccountData({ type: 'brokerage' }),
          trackingMode: 'investment',
          balanceSource,
        },
      });
      const res = await post({ accountId: account.id, amount: 10 });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(await testPrisma.accountBalance.count({ where: { accountId: account.id } })).toBe(0);
    }
  });
});
