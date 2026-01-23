import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { dashboardAnalytics, monthlySnapshot, paceForecast, buildWhere } from '@/lib/analytics';
import { setupTestDb, teardownTestDb, resetTestDb, getTestPrisma } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

describe('analytics', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();

    // Create standard test data
    const account = createAccountData({
      id: 'test-account',
      name: 'Test Account',
      currency: 'USD',
    });
    await prisma.account.create({ data: account });

    const categories = [
      createCategoryData({ id: 'cat-groceries', name: 'Groceries', type: 'expense' }),
      createCategoryData({ id: 'cat-restaurants', name: 'Restaurants', type: 'expense' }),
      createCategoryData({ id: 'cat-income', name: 'Income', type: 'income' }),
    ];
    await prisma.category.createMany({ data: categories });

    // Create user settings with base currency
    await prisma.userSettings.create({
      data: { baseCurrency: 'USD' },
    });
  });

  describe('buildWhere', () => {
    it('builds basic date filter', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const result = buildWhere({}, startDate, endDate);

      expect(result.date.gte).toEqual(startDate);
      expect(result.date.lte).toEqual(endDate);
    });

    it('includes account filter', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const result = buildWhere({ accounts: ['acc-1', 'acc-2'] }, startDate, endDate);

      expect(result.accountId).toEqual({ in: ['acc-1', 'acc-2'] });
    });

    it('includes category filter', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const result = buildWhere({ categories: ['cat-1'] }, startDate, endDate);

      expect(result.categoryId).toEqual({ in: ['cat-1'] });
    });

    it('includes merchant filter', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const result = buildWhere({ merchant: 'amazon' }, startDate, endDate);

      expect(result.merchant).toEqual({ contains: 'amazon', mode: 'insensitive' });
    });
  });

  describe('dashboardAnalytics', () => {
    it('calculates net cashflow (income minus spending)', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // Create transactions
      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: now,
            amount: 5000, // Income
            merchant: 'EMPLOYER',
            categoryId: 'cat-income',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -100, // Expense
            merchant: 'GROCERY STORE',
            categoryId: 'cat-groceries',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -50, // Expense
            merchant: 'RESTAURANT',
            categoryId: 'cat-restaurants',
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.netCashflow.income).toBe(5000);
      expect(result.netCashflow.spending).toBe(150);
      expect(result.netCashflow.savings).toBe(4850);
    });

    it('calculates savings rate correctly', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // Create transactions: $1000 income, $200 spending
      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: now,
            amount: 1000,
            merchant: 'EMPLOYER',
            categoryId: 'cat-income',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -200,
            merchant: 'STORE',
            categoryId: 'cat-groceries',
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Savings rate = (1000 - 200) / 1000 = 0.8 (80%)
      expect(result.savingsRate.rate).toBeCloseTo(0.8, 2);
    });

    it('returns 0 savings rate when income is 0', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // Only expenses, no income
      await prisma.transaction.create({
        data: createTransactionData('test-account', {
          date: now,
          amount: -100,
          merchant: 'STORE',
          categoryId: 'cat-groceries',
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.savingsRate.rate).toBe(0);
    });

    it('groups spending by category', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: now,
            amount: -100,
            merchant: 'GROCERY 1',
            categoryId: 'cat-groceries',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -50,
            merchant: 'GROCERY 2',
            categoryId: 'cat-groceries',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -75,
            merchant: 'RESTAURANT',
            categoryId: 'cat-restaurants',
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      const groceries = result.spendByCategory.find((c) => c.category === 'Groceries');
      const restaurants = result.spendByCategory.find((c) => c.category === 'Restaurants');

      expect(groceries?.amount).toBe(150);
      expect(groceries?.txCount).toBe(2);
      expect(restaurants?.amount).toBe(75);
      expect(restaurants?.txCount).toBe(1);
    });

    it('excludes linked returns from spending calculations', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // Create a purchase
      const purchase = await prisma.transaction.create({
        data: createTransactionData('test-account', {
          id: 'purchase-1',
          date: now,
          amount: -100,
          merchant: 'STORE',
          categoryId: 'cat-groceries',
        }),
      });

      // Create a linked return (offset)
      await prisma.transaction.create({
        data: createTransactionData('test-account', {
          date: now,
          amount: 100, // Return
          merchant: 'STORE REFUND',
          categoryId: 'cat-groceries',
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Return should offset the purchase, net spending = 0
      expect(result.netCashflow.spending).toBe(0);
    });

    it('calculates top merchants ordered by spend', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: now,
            amount: -200,
            merchant: 'BIG STORE',
            categoryId: 'cat-groceries',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -100,
            merchant: 'MEDIUM STORE',
            categoryId: 'cat-groceries',
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -50,
            merchant: 'SMALL STORE',
            categoryId: 'cat-groceries',
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.topMerchants[0].merchant).toBe('BIG STORE');
      expect(result.topMerchants[0].amount).toBe(200);
      expect(result.topMerchants[1].merchant).toBe('MEDIUM STORE');
      expect(result.topMerchants[2].merchant).toBe('SMALL STORE');
    });

    it('calculates month-over-month comparison', async () => {
      const now = new Date();
      const thisMonthStart = startOfMonth(now);
      const thisMonthEnd = endOfMonth(now);
      const lastMonth = subMonths(now, 1);

      // Last month: $1000 spending
      await prisma.transaction.create({
        data: createTransactionData('test-account', {
          date: lastMonth,
          amount: -1000,
          merchant: 'STORE',
          categoryId: 'cat-groceries',
        }),
      });

      // This month: $1500 spending (50% increase)
      await prisma.transaction.create({
        data: createTransactionData('test-account', {
          date: now,
          amount: -1500,
          merchant: 'STORE',
          categoryId: 'cat-groceries',
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, thisMonthStart, thisMonthEnd);

      expect(result.netCashflow.prevSpending).toBe(1000);
      expect(result.netCashflow.spending).toBe(1500);

      // Check month-over-month for category
      const groceries = result.spendByCategory.find((c) => c.category === 'Groceries');
      expect(groceries?.monthOverMonth).toBeCloseTo(50, 0); // 50% increase
    });

    it('excludes transfer transactions', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: now,
            amount: -500,
            merchant: 'TRANSFER',
            isTransfer: true,
          }),
          createTransactionData('test-account', {
            date: now,
            amount: -100,
            merchant: 'REAL EXPENSE',
            categoryId: 'cat-groceries',
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Only the real expense should be counted
      expect(result.netCashflow.spending).toBe(100);
    });

    it('handles multi-currency conversions', async () => {
      // Create EUR account
      const eurAccount = createAccountData({
        id: 'eur-account',
        name: 'Euro Account',
        currency: 'EUR',
      });
      await prisma.account.create({ data: eurAccount });

      // Set up exchange rate: 1 EUR = 1.1 USD
      await prisma.exchangeRate.create({
        data: {
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: 1.1,
        },
      });

      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // 100 EUR expense should be converted to 110 USD
      await prisma.transaction.create({
        data: createTransactionData('eur-account', {
          date: now,
          amount: -100,
          merchant: 'EURO STORE',
          categoryId: 'cat-groceries',
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.netCashflow.spending).toBeCloseTo(110, 0);
    });

    it('handles missing exchange rate gracefully', async () => {
      // Create account with uncommon currency (no exchange rate set)
      const foreignAccount = createAccountData({
        id: 'foreign-account',
        name: 'Foreign Account',
        currency: 'XYZ',
      });
      await prisma.account.create({ data: foreignAccount });

      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.create({
        data: createTransactionData('foreign-account', {
          date: now,
          amount: -100,
          merchant: 'FOREIGN STORE',
          categoryId: 'cat-groceries',
        }),
      });

      // Should not throw, falls back to 1:1 conversion
      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);
      expect(result.netCashflow.spending).toBe(100);
    });
  });

  describe('monthlySnapshot', () => {
    it('calculates monthly totals correctly', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: testDate,
            amount: 5000,
            merchant: 'EMPLOYER',
            categoryId: 'cat-income',
          }),
          createTransactionData('test-account', {
            date: testDate,
            amount: -200,
            merchant: 'GROCERY',
            categoryId: 'cat-groceries',
          }),
          createTransactionData('test-account', {
            date: testDate,
            amount: -100,
            merchant: 'RESTAURANT',
            categoryId: 'cat-restaurants',
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.incomeTotal).toBe(5000);
      expect(result.spendingTotal).toBe(300);
      expect(result.savingsTotal).toBe(4700);
      expect(result.savingsRatePct).toBeCloseTo(94, 0); // 4700/5000 * 100
      expect(result.categoryTotals['Groceries']).toBe(-200);
      expect(result.categoryTotals['Restaurants']).toBe(-100);
    });

    it('excludes transfer transactions', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: testDate,
            amount: -500,
            merchant: 'TRANSFER',
            isTransfer: true,
          }),
          createTransactionData('test-account', {
            date: testDate,
            amount: -100,
            merchant: 'REAL EXPENSE',
            categoryId: 'cat-groceries',
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.spendingTotal).toBe(100);
    });

    it('groups by merchant correctly', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData('test-account', {
            date: testDate,
            amount: -50,
            merchant: 'STARBUCKS',
            categoryId: 'cat-restaurants',
          }),
          createTransactionData('test-account', {
            date: testDate,
            amount: -30,
            merchant: 'STARBUCKS',
            categoryId: 'cat-restaurants',
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.merchantTotals['STARBUCKS']).toBe(-80);
    });
  });

  describe('paceForecast', () => {
    it('returns on-track status when pace is within budget', () => {
      // Use current month for realistic test
      const today = new Date();
      const startDate = startOfMonth(today);
      const endDate = endOfMonth(today);

      // Get days elapsed and total days to calculate appropriate spending
      const elapsedDays = Math.max(
        1,
        (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

      // Spend proportionally so we're on track (pace matches budget)
      const proportionalSpending = (500 * elapsedDays) / totalDays;
      const result = paceForecast(proportionalSpending, 500, startDate, endDate);

      expect(result.status).toBe('on-track');
    });

    it('returns over status when already over budget', () => {
      // Use current month for realistic test
      const today = new Date();
      const startDate = startOfMonth(today);
      const endDate = endOfMonth(today);

      // Spent more than budget
      const result = paceForecast(600, 500, startDate, endDate);

      expect(result.status).toBe('over');
    });

    it('returns trending-over when forecast exceeds budget by more than 5%', () => {
      // Use current month for realistic test
      const today = new Date();
      const startDate = startOfMonth(today);
      const endDate = endOfMonth(today);

      // Get days elapsed and total days
      const elapsedDays = Math.max(
        1,
        (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

      // Spend significantly more than proportional (twice the pace)
      // to trigger trending-over status
      const highSpending = (500 * 2 * elapsedDays) / totalDays;
      const result = paceForecast(highSpending, 500, startDate, endDate);

      // If already over budget, status is 'over'; otherwise 'trending-over'
      expect(['over', 'trending-over']).toContain(result.status);
    });

    it('calculates forecast based on pace', () => {
      const today = new Date();
      const startDate = startOfMonth(today);
      const endDate = endOfMonth(today);

      // If we've spent $100 over X days, forecast is pace * total days
      const result = paceForecast(100, 1000, startDate, endDate);

      expect(result.forecast).toBeGreaterThan(0);
    });
  });
});
