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

import { dashboardAnalytics } from '@/lib/analytics';
import { UNCATEGORIZED } from '@/lib/transaction-filters';
import { GET as getTransactions } from '@/app/api/transactions/route';

const START = new Date(Date.UTC(2026, 9, 1));
const END = new Date(Date.UTC(2026, 9, 31, 23, 59, 59, 999));
const DAY = new Date(Date.UTC(2026, 9, 10));

describe('shared transaction filters', () => {
  let accountId: string;
  let categoryId: string;

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    const account = createAccountData({ id: 'acc', name: 'Checking', currency: 'USD' });
    await testPrisma.account.create({ data: account });
    accountId = account.id!;
    const category = await testPrisma.category.create({
      data: createCategoryData({ name: 'Fun', type: 'expense' }),
    });
    categoryId = category.id;
    await testPrisma.userSettings.create({ data: { baseCurrency: 'USD' } });
  });

  async function addTagged() {
    await testPrisma.transaction.createMany({
      data: [
        createTransactionData(accountId, {
          date: DAY,
          amount: -10,
          merchant: 'A',
          tags: '["Vacation"]',
          categoryId,
        }),
        createTransactionData(accountId, {
          date: DAY,
          amount: -20,
          merchant: 'B',
          tags: '["Shared"]',
          categoryId,
        }),
        createTransactionData(accountId, {
          date: DAY,
          amount: -40,
          merchant: 'C',
          tags: '["Work"]',
          categoryId,
        }),
      ],
    });
  }

  it('tagFilterMatchesAnyPickedTag', async () => {
    await addTagged();
    const result = await dashboardAnalytics(
      testPrisma,
      { tags: ['Vacation', 'Shared'] },
      START,
      END
    );
    expect(result.netCashflow.spending).toBe(30);
  });

  it('merchantFilterIgnoresCase', async () => {
    await testPrisma.transaction.create({
      data: createTransactionData(accountId, {
        date: DAY,
        amount: -75,
        merchant: 'TaylorMade',
        categoryId,
      }),
    });
    const result = await dashboardAnalytics(testPrisma, { merchant: 'taylormade' }, START, END);
    expect(result.netCashflow.spending).toBe(75);
  });

  it('uncategorizedPickFindsRowsWithNoCategory', async () => {
    await testPrisma.transaction.createMany({
      data: [
        createTransactionData(accountId, { date: DAY, amount: -15, merchant: 'X' }),
        createTransactionData(accountId, { date: DAY, amount: -25, merchant: 'Y', categoryId }),
      ],
    });
    const result = await dashboardAnalytics(
      testPrisma,
      { categories: [UNCATEGORIZED] },
      START,
      END
    );
    expect(result.netCashflow.spending).toBe(15);
  });

  it('transactionsRouteUsesSameTagRule', async () => {
    await addTagged();
    const res = await getTransactions(
      new NextRequest(
        'http://localhost/api/transactions?tag=Vacation&tag=Shared&preset=custom&startDate=2026-10-01&endDate=2026-10-31'
      )
    );
    const body = await res.json();
    expect(body.transactions.map((t: { merchant: string }) => t.merchant).sort()).toEqual([
      'A',
      'B',
    ]);
  });
});
