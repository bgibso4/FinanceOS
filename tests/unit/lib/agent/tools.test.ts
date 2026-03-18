import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
  createBudgetData,
} from '../../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import {
  executeGetCategories,
  executeQueryTransactions,
  executeGetAccountBalances,
  executeGetCategoryBreakdown,
  executeGetMerchantBreakdown,
  executeGetBudgetStatus,
  executeGetMonthlyTrend,
  executeGetCashFlow,
  executeGetRecurringTransactions,
} from '@/lib/agent/tools';

describe('agent tools', () => {
  let prisma: PrismaClient;
  let accountId: string;
  let groceryId: string;
  let transportId: string;
  let foodGroupId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await resetTestDb();

    const account = createAccountData({ name: 'Checking', type: 'checking' });
    await prisma.account.create({ data: account });
    accountId = account.id!;

    const foodGroup = createCategoryData({ name: 'Food & Dining', type: 'expense' });
    await prisma.category.create({ data: foodGroup });
    foodGroupId = foodGroup.id!;

    const grocery = createCategoryData({
      name: 'Groceries',
      type: 'expense',
      parentId: foodGroupId,
    });
    await prisma.category.create({ data: grocery });
    groceryId = grocery.id!;

    const transport = createCategoryData({ name: 'Transport', type: 'expense' });
    await prisma.category.create({ data: transport });
    transportId = transport.id!;

    await prisma.transaction.create({
      data: createTransactionData(accountId, {
        merchant: 'Whole Foods',
        amount: -85.5,
        categoryId: groceryId,
        date: new Date('2026-01-15'),
      }),
    });
    await prisma.transaction.create({
      data: createTransactionData(accountId, {
        merchant: 'Uber',
        amount: -25.0,
        categoryId: transportId,
        date: new Date('2026-01-20'),
      }),
    });
    await prisma.transaction.create({
      data: createTransactionData(accountId, {
        merchant: 'Employer Inc',
        amount: 5000.0,
        date: new Date('2026-01-01'),
      }),
    });
  });

  describe('executeGetCategories', () => {
    it('returns category tree with parent names', async () => {
      const result = await executeGetCategories(prisma);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Groceries',
          type: 'expense',
          parentName: 'Food & Dining',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'Transport', type: 'expense', parentName: null })
      );
    });

    it('does not include internal IDs', async () => {
      const result = await executeGetCategories(prisma);
      for (const cat of result) {
        expect(cat).not.toHaveProperty('id');
        expect(cat).not.toHaveProperty('parentId');
      }
    });
  });

  describe('executeQueryTransactions', () => {
    it('returns transactions within date range', async () => {
      const result = await executeQueryTransactions(prisma, {
        startDate: '2026-01-10',
        endDate: '2026-01-31',
      });
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0]).toHaveProperty('merchant');
      expect(result.transactions[0]).toHaveProperty('amount');
      expect(result.transactions[0]).toHaveProperty('date');
    });

    it('does not include importHash or externalId', async () => {
      const result = await executeQueryTransactions(prisma, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      for (const tx of result.transactions) {
        expect(tx).not.toHaveProperty('importHash');
        expect(tx).not.toHaveProperty('externalId');
        expect(tx).not.toHaveProperty('id');
      }
    });

    it('filters by category name', async () => {
      const result = await executeQueryTransactions(prisma, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        category: 'Groceries',
      });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].merchant).toBe('Whole Foods');
    });

    it('filters by tag', async () => {
      await prisma.transaction.create({
        data: createTransactionData(accountId, {
          merchant: 'Whistler Hotel',
          amount: -350.0,
          date: new Date('2026-01-10'),
          tags: JSON.stringify(['Whistler 2026', 'Travel']),
        }),
      });
      await prisma.transaction.create({
        data: createTransactionData(accountId, {
          merchant: 'Ski Rental',
          amount: -120.0,
          date: new Date('2026-01-11'),
          tags: JSON.stringify(['Whistler 2026']),
        }),
      });

      const result = await executeQueryTransactions(prisma, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        tag: 'Whistler 2026',
      });
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions.map((t) => t.merchant)).toContain('Whistler Hotel');
      expect(result.transactions.map((t) => t.merchant)).toContain('Ski Rental');
    });
  });

  describe('executeGetAccountBalances', () => {
    it('returns account info without sensitive data', async () => {
      const result = await executeGetAccountBalances(prisma);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('name', 'Checking');
      expect(result[0]).toHaveProperty('type', 'checking');
      expect(result[0]).not.toHaveProperty('id');
    });
  });

  describe('executeGetCategoryBreakdown', () => {
    it('returns spending grouped by category with parent group', async () => {
      const result = await executeGetCategoryBreakdown(prisma, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      const grocery = result.find((r: any) => r.category === 'Groceries');
      expect(grocery).toBeDefined();
      expect(grocery!.group).toBe('Food & Dining');
      expect(grocery!.amount).toBeCloseTo(85.5);
    });
  });

  describe('executeGetMerchantBreakdown', () => {
    it('returns spending grouped by merchant', async () => {
      const result = await executeGetMerchantBreakdown(prisma, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      expect(result).toContainEqual(expect.objectContaining({ merchant: 'Whole Foods', count: 1 }));
    });
  });

  describe('executeGetBudgetStatus', () => {
    it('returns budget vs actual', async () => {
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryId, { month: '2026-01', limitAmount: 200 }),
      });
      const result = await executeGetBudgetStatus(prisma, { month: '2026-01' });
      const grocery = result.find((r: any) => r.category === 'Groceries');
      expect(grocery).toBeDefined();
      expect(grocery!.budgeted).toBe(200);
      expect(grocery!.actual).toBeCloseTo(85.5);
      expect(grocery!.remaining).toBeCloseTo(114.5);
    });
  });

  describe('executeGetMonthlyTrend', () => {
    it('returns monthly income/spending/net', async () => {
      const result = await executeGetMonthlyTrend(prisma, { months: 2 });
      const jan = result.find((r: any) => r.month === '2026-01');
      expect(jan).toBeDefined();
      expect(jan!.income).toBeCloseTo(5000);
      expect(jan!.spending).toBeCloseTo(110.5);
    });
  });

  describe('executeGetCashFlow', () => {
    it('returns income vs expense summary', async () => {
      const result = await executeGetCashFlow(prisma, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      expect(result.income).toBeCloseTo(5000);
      expect(result.expenses).toBeCloseTo(110.5);
      expect(result.net).toBeCloseTo(4889.5);
    });
  });

  describe('executeGetRecurringTransactions', () => {
    it('returns empty array when no recurring transactions exist', async () => {
      const result = await executeGetRecurringTransactions(prisma, {});
      expect(result).toEqual([]);
    });
  });
});
