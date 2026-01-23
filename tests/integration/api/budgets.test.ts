import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createCategoryData, createBudgetData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('budgets API integration', () => {
  let prisma: PrismaClient;
  let groceryCategoryId: string;
  let transportCategoryId: string;
  let entertainmentCategoryId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();

    // Create categories for budgets
    const categories = await Promise.all([
      prisma.category.create({
        data: createCategoryData({ name: 'Groceries', type: 'expense' }),
      }),
      prisma.category.create({
        data: createCategoryData({ name: 'Transport', type: 'expense' }),
      }),
      prisma.category.create({
        data: createCategoryData({ name: 'Entertainment', type: 'expense' }),
      }),
    ]);

    groceryCategoryId = categories[0].id;
    transportCategoryId = categories[1].id;
    entertainmentCategoryId = categories[2].id;
  });

  describe('GET budgets for month', () => {
    it('returns empty array when no budgets exist', async () => {
      const budgets = await prisma.categoryBudget.findMany({
        where: { month: '2024-01' },
      });
      expect(budgets).toHaveLength(0);
    });

    it('returns default budgets', async () => {
      await prisma.categoryBudget.createMany({
        data: [
          createBudgetData(groceryCategoryId, {
            month: 'default',
            limitAmount: 500,
          }),
          createBudgetData(transportCategoryId, {
            month: 'default',
            limitAmount: 200,
          }),
        ],
      });

      const budgets = await prisma.categoryBudget.findMany({
        where: { month: 'default' },
        include: { category: true },
      });

      expect(budgets).toHaveLength(2);
    });

    it('returns month-specific budgets', async () => {
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 600,
        }),
      });

      const budgets = await prisma.categoryBudget.findMany({
        where: { month: '2024-01' },
      });

      expect(budgets).toHaveLength(1);
      expect(Number(budgets[0].limitAmount)).toBe(600);
    });

    it('merges default and month-specific budgets', async () => {
      // Create default budgets
      await prisma.categoryBudget.createMany({
        data: [
          createBudgetData(groceryCategoryId, {
            month: 'default',
            limitAmount: 500,
          }),
          createBudgetData(transportCategoryId, {
            month: 'default',
            limitAmount: 200,
          }),
        ],
      });

      // Create month-specific override for groceries
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 700, // Override
        }),
      });

      const [defaultBudgets, monthBudgets] = await Promise.all([
        prisma.categoryBudget.findMany({
          where: { month: 'default' },
        }),
        prisma.categoryBudget.findMany({
          where: { month: '2024-01' },
        }),
      ]);

      // Build merged budget map
      const budgetMap = new Map<string, number>();
      defaultBudgets.forEach((b) => {
        budgetMap.set(b.categoryId, Number(b.limitAmount));
      });
      monthBudgets.forEach((b) => {
        budgetMap.set(b.categoryId, Number(b.limitAmount));
      });

      expect(budgetMap.get(groceryCategoryId)).toBe(700); // Override
      expect(budgetMap.get(transportCategoryId)).toBe(200); // Default
    });
  });

  describe('POST/PUT budget', () => {
    it('creates default budget', async () => {
      const created = await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: 'default',
          limitAmount: 500,
        }),
      });

      expect(created.id).toBeDefined();
      expect(created.month).toBe('default');
      expect(Number(created.limitAmount)).toBe(500);
    });

    it('creates month-specific budget', async () => {
      const created = await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 600,
        }),
      });

      expect(created.month).toBe('2024-01');
      expect(Number(created.limitAmount)).toBe(600);
    });

    it('upserts budget for same category and month', async () => {
      // Create initial budget
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 500,
        }),
      });

      // Upsert with new amount
      const upserted = await prisma.categoryBudget.upsert({
        where: {
          month_categoryId: {
            month: '2024-01',
            categoryId: groceryCategoryId,
          },
        },
        update: { limitAmount: 750 },
        create: {
          categoryId: groceryCategoryId,
          month: '2024-01',
          limitAmount: 750,
        },
      });

      expect(Number(upserted.limitAmount)).toBe(750);

      // Verify only one budget exists
      const count = await prisma.categoryBudget.count({
        where: {
          categoryId: groceryCategoryId,
          month: '2024-01',
        },
      });
      expect(count).toBe(1);
    });
  });

  describe('DELETE budget', () => {
    it('deletes month-specific budget (reverts to default)', async () => {
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 600,
        }),
      });

      await prisma.categoryBudget.deleteMany({
        where: {
          categoryId: groceryCategoryId,
          month: '2024-01',
        },
      });

      const found = await prisma.categoryBudget.findFirst({
        where: {
          categoryId: groceryCategoryId,
          month: '2024-01',
        },
      });
      expect(found).toBeNull();
    });

    it('deletes default budget', async () => {
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: 'default',
          limitAmount: 500,
        }),
      });

      await prisma.categoryBudget.deleteMany({
        where: {
          categoryId: groceryCategoryId,
          month: 'default',
        },
      });

      const found = await prisma.categoryBudget.findFirst({
        where: {
          categoryId: groceryCategoryId,
          month: 'default',
        },
      });
      expect(found).toBeNull();
    });
  });

  describe('budget tracking calculations', () => {
    it('calculates spent amount for category in month', async () => {
      const account = await prisma.account.create({
        data: { name: 'Test Account', type: 'checking' },
      });

      // Create transactions for January
      await prisma.transaction.createMany({
        data: [
          {
            accountId: account.id,
            categoryId: groceryCategoryId,
            date: new Date('2024-01-05'),
            amount: -100,
            merchant: 'Store 1',
            merchantNormalized: 'store 1',
          },
          {
            accountId: account.id,
            categoryId: groceryCategoryId,
            date: new Date('2024-01-15'),
            amount: -150,
            merchant: 'Store 2',
            merchantNormalized: 'store 2',
          },
          {
            accountId: account.id,
            categoryId: groceryCategoryId,
            date: new Date('2024-01-25'),
            amount: -75,
            merchant: 'Store 3',
            merchantNormalized: 'store 3',
          },
        ],
      });

      // Calculate total spent
      const result = await prisma.transaction.aggregate({
        where: {
          categoryId: groceryCategoryId,
          date: {
            gte: new Date('2024-01-01'),
            lt: new Date('2024-02-01'),
          },
          amount: { lt: 0 }, // Only expenses
        },
        _sum: { amount: true },
      });

      const spent = Math.abs(Number(result._sum.amount) || 0);
      expect(spent).toBe(325);
    });

    it('calculates remaining budget', async () => {
      const budget = await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 500,
        }),
      });

      const account = await prisma.account.create({
        data: { name: 'Test Account', type: 'checking' },
      });

      await prisma.transaction.create({
        data: {
          accountId: account.id,
          categoryId: groceryCategoryId,
          date: new Date('2024-01-15'),
          amount: -200,
          merchant: 'Store',
          merchantNormalized: 'store',
        },
      });

      const result = await prisma.transaction.aggregate({
        where: {
          categoryId: groceryCategoryId,
          date: {
            gte: new Date('2024-01-01'),
            lt: new Date('2024-02-01'),
          },
          amount: { lt: 0 },
        },
        _sum: { amount: true },
      });

      const spent = Math.abs(Number(result._sum.amount) || 0);
      const remaining = Number(budget.limitAmount) - spent;

      expect(remaining).toBe(300);
    });

    it('identifies over-budget categories', async () => {
      await prisma.categoryBudget.create({
        data: createBudgetData(groceryCategoryId, {
          month: '2024-01',
          limitAmount: 200, // Low budget
        }),
      });

      const account = await prisma.account.create({
        data: { name: 'Test Account', type: 'checking' },
      });

      // Spend more than budget
      await prisma.transaction.createMany({
        data: [
          {
            accountId: account.id,
            categoryId: groceryCategoryId,
            date: new Date('2024-01-10'),
            amount: -150,
            merchant: 'Store 1',
            merchantNormalized: 'store 1',
          },
          {
            accountId: account.id,
            categoryId: groceryCategoryId,
            date: new Date('2024-01-20'),
            amount: -100,
            merchant: 'Store 2',
            merchantNormalized: 'store 2',
          },
        ],
      });

      const result = await prisma.transaction.aggregate({
        where: {
          categoryId: groceryCategoryId,
          date: {
            gte: new Date('2024-01-01'),
            lt: new Date('2024-02-01'),
          },
          amount: { lt: 0 },
        },
        _sum: { amount: true },
      });

      const spent = Math.abs(Number(result._sum.amount) || 0);
      const budget = 200;
      const isOverBudget = spent > budget;

      expect(isOverBudget).toBe(true);
      expect(spent).toBe(250);
    });
  });
});
