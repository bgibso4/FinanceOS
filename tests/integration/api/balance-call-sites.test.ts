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

import { GET as getBalances } from '@/app/api/accounts/balances/route';
import { POST as postSnapshot } from '@/app/api/snapshots/route';
import { calculateGoalProgress } from '@/lib/goals';
import { executeGetAccountBalances } from '@/lib/agent/tools';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

describe('balance call sites use the resolver', () => {
  let investmentId: string;
  let checkingId: string;

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    const inv = await testPrisma.account.create({
      data: {
        ...createAccountData({ name: 'Brokerage', type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Provider,
      },
    });
    investmentId = inv.id;
    await testPrisma.accountBalance.create({
      data: {
        accountId: inv.id,
        date: new Date('2026-10-09T00:00:00Z'),
        balance: 5000,
        currency: 'USD',
        source: BalanceRowSource.Synced,
      },
    });
    // stray legacy row that must be ignored
    await testPrisma.transaction.create({
      data: {
        accountId: inv.id,
        date: new Date('2026-01-01'),
        amount: 123,
        merchant: 'Balance Adjustment',
      },
    });
    const chk = await testPrisma.account.create({ data: createAccountData({ name: 'Checking' }) });
    checkingId = chk.id;
    const parent = await testPrisma.transaction.create({
      data: {
        accountId: chk.id,
        date: new Date('2026-10-01'),
        amount: -100,
        merchant: 'split',
        isSplitParent: true,
      },
    });
    await testPrisma.transaction.create({
      data: {
        accountId: chk.id,
        date: new Date('2026-10-01'),
        amount: -100,
        merchant: 'part',
        parentTransactionId: parent.id,
      },
    });
    await testPrisma.transaction.create({
      data: { accountId: chk.id, date: new Date('2026-10-01'), amount: 1000, merchant: 'pay' },
    });
  });

  it('accounts/balances reports resolver balances', async () => {
    const body = await (await getBalances()).json();
    const byId = Object.fromEntries(
      body.accounts.map((a: { id: string; balance: number }) => [a.id, a.balance])
    );
    expect(byId[investmentId]).toBe(5000);
    expect(byId[checkingId]).toBe(900);
  });

  it('snapshot POST stores resolver balances (split parents not double counted)', async () => {
    const req = new NextRequest('http://localhost/api/snapshots', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const body = await (await postSnapshot(req)).json();
    expect(body.snapshot.accountBalances[investmentId].balance).toBe(5000);
    expect(body.snapshot.accountBalances[checkingId].balance).toBe(900);
  });

  it('account goals use the resolver', async () => {
    const goal = await testPrisma.goal.create({
      data: {
        name: 'g',
        type: 'saving',
        targetAmount: 10000,
        trackingMethod: 'account',
        accountId: investmentId,
      },
    });
    expect((await calculateGoalProgress(goal, testPrisma)).currentAmount).toBe(5000);
  });

  it('agent balance tool uses the resolver', async () => {
    const rows = await executeGetAccountBalances(testPrisma);
    expect(rows.find((r) => r.name === 'Brokerage')?.balance).toBe(5000);
    expect(rows.find((r) => r.name === 'Checking')?.balance).toBe(900);
  });
});
