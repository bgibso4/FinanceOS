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

import { dashboardAnalytics, spendingByDay, type DaySpend } from '@/lib/analytics';
import { GET as getDaily } from '@/app/api/analytics/daily/route';

const START = new Date(Date.UTC(2026, 9, 1));
const END = new Date(Date.UTC(2026, 9, 31, 23, 59, 59, 999));
const AUG = {
  startDate: new Date(Date.UTC(2026, 7, 1)),
  endDate: new Date(Date.UTC(2026, 7, 31, 23, 59, 59, 999)),
};
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const sum = (rows: DaySpend[]) => rows.reduce((acc, r) => acc + r.amount, 0);

describe('daily spend and explicit comparison', () => {
  let groceries: string;
  let dining: string;
  let purchaseId: string;

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    await testPrisma.userSettings.create({ data: { baseCurrency: 'USD' } });
    await testPrisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 },
    });
    await testPrisma.account.create({ data: createAccountData({ id: 'usd', currency: 'USD' }) });
    await testPrisma.account.create({ data: createAccountData({ id: 'cad', currency: 'CAD' }) });
    groceries = (
      await testPrisma.category.create({
        data: createCategoryData({ name: 'Groceries', type: 'expense' }),
      })
    ).id;
    dining = (
      await testPrisma.category.create({
        data: createCategoryData({ name: 'Dining', type: 'expense' }),
      })
    ).id;
    const salary = (
      await testPrisma.category.create({
        data: createCategoryData({ name: 'Salary', type: 'income' }),
      })
    ).id;

    const purchase = createTransactionData('usd', {
      date: day('2026-10-10'),
      amount: -60,
      merchant: 'Shop',
      categoryId: groceries,
    });
    purchaseId = purchase.id!;
    await testPrisma.transaction.createMany({
      data: [
        createTransactionData('usd', {
          date: day('2026-10-03'),
          amount: -100,
          categoryId: groceries,
        }),
        createTransactionData('cad', { date: day('2026-10-03'), amount: -40, categoryId: dining }),
        purchase,
        // Linked return dated after the period still nets the October purchase
        createTransactionData('usd', {
          date: day('2026-11-05'),
          amount: 20,
          merchant: 'Shop',
          categoryId: groceries,
          isOffset: true,
          linkedTransactionId: purchaseId,
        }),
        // Credit in an expense category reduces that category
        createTransactionData('usd', { date: day('2026-10-12'), amount: 15, categoryId: dining }),
        createTransactionData('usd', { date: day('2026-10-15'), amount: 2000, categoryId: salary }),
        createTransactionData('usd', {
          date: day('2026-10-16'),
          amount: -500,
          isTransfer: true,
          categoryId: groceries,
        }),
        createTransactionData('usd', { date: day('2026-10-20'), amount: -25 }),
        // History: one row inside the default previous window, one only in August
        createTransactionData('usd', {
          date: day('2026-09-05'),
          amount: -50,
          categoryId: groceries,
        }),
        createTransactionData('usd', {
          date: day('2026-08-20'),
          amount: -70,
          categoryId: groceries,
        }),
      ],
    });
  });

  it('dailySumsMatchDashboard', async () => {
    const [daily, dash] = await Promise.all([
      spendingByDay(testPrisma, {}, START, END),
      dashboardAnalytics(testPrisma, {}, START, END),
    ]);

    // 100 + 40 CAD (30) + (60 − 20) − 15 + 25
    expect(dash.netCashflow.spending).toBeCloseTo(180, 6);
    expect(sum(daily)).toBeCloseTo(dash.netCashflow.spending, 6);

    const names: Record<string, string> = { [groceries]: 'Groceries', [dining]: 'Dining' };
    const byName: Record<string, number> = {};
    for (const r of daily) {
      const name = r.categoryId ? names[r.categoryId] : 'Uncategorized';
      byName[name] = (byName[name] ?? 0) + r.amount;
    }
    for (const c of dash.spendByCategory) {
      expect(byName[c.category]).toBeCloseTo(c.amount, 6);
    }
    expect(Object.keys(byName).sort()).toEqual(dash.spendByCategory.map((c) => c.category).sort());

    expect(daily).toHaveLength(5);
    expect(daily).toEqual(
      expect.arrayContaining([
        { date: '2026-10-03', categoryId: groceries, amount: 100 },
        { date: '2026-10-03', categoryId: dining, amount: 30 },
        { date: '2026-10-12', categoryId: dining, amount: -15 },
        { date: '2026-10-20', categoryId: null, amount: 25 },
      ])
    );
  });

  it('returnOutsidePeriodStillNetsPurchase', async () => {
    const daily = await spendingByDay(testPrisma, {}, START, END);
    expect(daily).toContainEqual({ date: '2026-10-10', categoryId: groceries, amount: 40 });

    // The return itself never shows up as a day of its own
    const november = await spendingByDay(
      testPrisma,
      {},
      new Date(Date.UTC(2026, 10, 1)),
      new Date(Date.UTC(2026, 10, 30, 23, 59, 59, 999))
    );
    expect(november).toEqual([]);
  });

  it('explicitCompareRangeIsUsed', async () => {
    const dash = await dashboardAnalytics(testPrisma, {}, START, END, AUG);
    expect(dash.netCashflow.prevSpending).toBeCloseTo(70, 6);
    expect(dash.prevTransactionCount).toBe(1);
    expect(dash.netCashflow.spending).toBeCloseTo(180, 6);
  });

  it('noCompareRangeKeepsOldBehaviour', async () => {
    const without = await dashboardAnalytics(testPrisma, {}, START, END);
    // Old rule: the same-length window just before the period (Aug 31 00:00:00.001 – Sep 30)
    expect(without.netCashflow.prevSpending).toBeCloseTo(50, 6);
    const oldWindow = {
      startDate: new Date(START.getTime() - (END.getTime() - START.getTime())),
      endDate: new Date(START.getTime() - 1),
    };
    expect(await dashboardAnalytics(testPrisma, {}, START, END, oldWindow)).toEqual(without);
  });

  it('prevOnlyCategoryListedWithExplicitCompare', async () => {
    const travel = (
      await testPrisma.category.create({
        data: createCategoryData({ name: 'Travel', type: 'expense' }),
      })
    ).id;
    await testPrisma.transaction.create({
      data: createTransactionData('usd', {
        date: day('2026-09-10'),
        amount: -90,
        categoryId: travel,
      }),
    });
    const SEP = {
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: new Date(Date.UTC(2026, 8, 30, 23, 59, 59, 999)),
    };
    const total = (rows: { amount: number; prevAmount: number }[], key: 'amount' | 'prevAmount') =>
      rows.reduce((acc, r) => acc + r[key], 0);

    const withCompare = await dashboardAnalytics(testPrisma, {}, START, END, SEP);

    expect(withCompare.spendByCategory).toContainEqual(
      expect.objectContaining({ category: 'Travel', amount: 0, prevAmount: 90, txCount: 0 })
    );
    expect(total(withCompare.spendByCategory, 'amount')).toBeCloseTo(
      withCompare.netCashflow.spending,
      6
    );
    expect(total(withCompare.spendByCategory, 'prevAmount')).toBeCloseTo(
      withCompare.netCashflow.prevSpending,
      6
    );

    // Without an explicit comparison (home, Reports, trailing-12) the list is as before.
    const without = await dashboardAnalytics(testPrisma, {}, START, END);
    expect(without.netCashflow.prevSpending).toBeCloseTo(140, 6);
    expect(without.spendByCategory.map((c) => c.category)).not.toContain('Travel');
  });

  it('dailyRouteReturnsBothRanges', async () => {
    const res = await getDaily(
      new NextRequest(
        'http://localhost/api/analytics/daily?startDate=2026-10-01&endDate=2026-10-31' +
          '&compareStart=2026-08-01&compareEnd=2026-08-31'
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sum(body.current)).toBeCloseTo(180, 6);
    expect(body.compare).toEqual([{ date: '2026-08-20', categoryId: groceries, amount: 70 }]);

    const noCompare = await getDaily(
      new NextRequest(
        'http://localhost/api/analytics/daily?startDate=2026-10-01&endDate=2026-10-31'
      )
    );
    expect((await noCompare.json()).compare).toBeNull();
  });
});
