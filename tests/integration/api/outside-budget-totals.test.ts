import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { dashboardAnalytics, monthlySnapshot, spendingByTag } from '@/lib/analytics';
import { GET as getTrailing } from '@/app/api/reports/trailing-12-months/route';
import { GET as getDaily } from '@/app/api/analytics/daily/route';

const START = new Date(Date.UTC(2026, 9, 1));
const END = new Date(Date.UTC(2026, 9, 31, 23, 59, 59, 999));
const OCT = { startDate: '2026-10-01', endDate: '2026-10-31' };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('where outside-budget rows count', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    await testPrisma.userSettings.create({ data: { baseCurrency: 'USD' } });
    await testPrisma.account.create({ data: createAccountData({ id: 'usd', currency: 'USD' }) });
    const groceries = await testPrisma.category.create({
      data: createCategoryData({ name: 'Groceries', type: 'expense' }),
    });
    await testPrisma.transaction.createMany({
      data: [
        createTransactionData('usd', {
          date: day('2026-10-10'),
          amount: -100,
          merchant: 'Shop',
          categoryId: groceries.id,
        }),
        createTransactionData('usd', {
          date: day('2026-10-12'),
          amount: -1440,
          merchant: 'Lawyer',
          categoryId: groceries.id,
          isOutsideBudget: true,
          tags: JSON.stringify(['Green Card']),
        }),
      ],
    });
  });

  it('leftOutByDefault', async () => {
    const data = await dashboardAnalytics(testPrisma, OCT, START, END);
    expect(data.netCashflow.spending).toBe(100);
  });

  it('includedWhenAsked', async () => {
    const data = await dashboardAnalytics(
      testPrisma,
      { ...OCT, includeOutsideBudget: true },
      START,
      END
    );
    expect(data.netCashflow.spending).toBe(1540);
  });

  it('tagFilterAloneLeavesItOut', async () => {
    const data = await dashboardAnalytics(testPrisma, { ...OCT, tags: ['Green Card'] }, START, END);
    expect(data.netCashflow.spending).toBe(0);
  });

  it('snapshotLeavesItOut', async () => {
    const snap = await monthlySnapshot(testPrisma, '2026-10');
    expect(snap.spendingTotal).toBe(100);
  });

  it('tagTotalsIncludeIt', async () => {
    const tags = await spendingByTag(testPrisma);
    expect(tags.get('Green Card')?.total).toBe(1440);
  });

  it('cashFlowIncludesIt', async () => {
    const res = await getTrailing(
      new NextRequest('http://localhost/api/reports/trailing-12-months?month=2026-10')
    );
    const { months } = await res.json();
    expect(months.find((m: { month: string }) => m.month === '2026-10').spending).toBe(1540);
  });

  it('dailyRouteReadsTheParam', async () => {
    const total = async (extra: string) => {
      const res = await getDaily(
        new NextRequest(
          `http://localhost/api/analytics/daily?startDate=2026-10-01&endDate=2026-10-31${extra}`
        )
      );
      const { current } = await res.json();
      return current.reduce((acc: number, r: { amount: number }) => acc + r.amount, 0);
    };
    expect(await total('&outside=1')).toBe(1540);
    expect(await total('')).toBe(100);
  });
});
