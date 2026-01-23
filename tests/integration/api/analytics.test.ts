import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import { dashboardAnalytics, buildWhere } from '@/lib/analytics';
import { parseFilters, resolveDateRange } from '@/lib/filters';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

describe('analytics API integration', () => {
  let prisma: PrismaClient;
  let testAccountId: string;
  let testAccountId2: string;
  let groceryCategoryId: string;
  let transportCategoryId: string;
  let incomeCategoryId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();

    // Create test accounts
    const account = createAccountData({ id: 'test-account', name: 'Checking', currency: 'USD' });
    await prisma.account.create({ data: account });
    testAccountId = account.id!;

    const account2 = createAccountData({ id: 'test-account-2', name: 'Savings', currency: 'USD' });
    await prisma.account.create({ data: account2 });
    testAccountId2 = account2.id!;

    // Create categories
    const groceryCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Groceries', type: 'expense' }),
    });
    const transportCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Transport', type: 'expense' }),
    });
    const incomeCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Salary', type: 'income' }),
    });

    groceryCategoryId = groceryCategory.id;
    transportCategoryId = transportCategory.id;
    incomeCategoryId = incomeCategory.id;

    // Create user settings
    await prisma.userSettings.create({
      data: { baseCurrency: 'USD' },
    });
  });

  describe('GET /api/analytics/dashboard', () => {
    it('returns complete dashboard payload', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: 5000,
            merchant: 'EMPLOYER',
            categoryId: incomeCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: now,
            amount: -200,
            merchant: 'TRADER JOES',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: now,
            amount: -100,
            merchant: 'UBER',
            categoryId: transportCategoryId,
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Check all required fields are present
      expect(result).toHaveProperty('netCashflow');
      expect(result).toHaveProperty('savingsRate');
      expect(result).toHaveProperty('spendByCategory');
      expect(result).toHaveProperty('topMerchants');
      expect(result).toHaveProperty('incomeVsSpending');
      expect(result).toHaveProperty('trendAlerts');
      expect(result).toHaveProperty('transactionCount');
    });

    it('filters by date preset this-month', async () => {
      const now = new Date();
      const lastMonth = subMonths(now, 1);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: -100,
            merchant: 'THIS MONTH',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: lastMonth,
            amount: -200,
            merchant: 'LAST MONTH',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const { startDate, endDate } = resolveDateRange('this-month', undefined, undefined);
      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.transactionCount).toBe(1);
      expect(result.topMerchants[0].merchant).toBe('THIS MONTH');
    });

    it('filters by date preset last-3-months', async () => {
      const now = new Date();
      const twoMonthsAgo = subMonths(now, 2);
      const fourMonthsAgo = subMonths(now, 4);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: -100,
            merchant: 'RECENT',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: twoMonthsAgo,
            amount: -150,
            merchant: 'IN RANGE',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: fourMonthsAgo,
            amount: -200,
            merchant: 'OUT OF RANGE',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const { startDate, endDate } = resolveDateRange('last-3-months', undefined, undefined);
      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Should include transactions from last 3 months
      expect(result.transactionCount).toBe(2);
    });

    it('filters by account', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: -100,
            merchant: 'CHECKING EXPENSE',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId2, {
            date: now,
            amount: -200,
            merchant: 'SAVINGS EXPENSE',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const result = await dashboardAnalytics(
        prisma,
        { accounts: [testAccountId] },
        startDate,
        endDate
      );

      expect(result.transactionCount).toBe(1);
      expect(result.topMerchants[0].merchant).toBe('CHECKING EXPENSE');
    });

    it('filters by category', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: -100,
            merchant: 'GROCERY STORE',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: now,
            amount: -50,
            merchant: 'UBER',
            categoryId: transportCategoryId,
          }),
        ],
      });

      const result = await dashboardAnalytics(
        prisma,
        { categories: [groceryCategoryId] },
        startDate,
        endDate
      );

      expect(result.transactionCount).toBe(1);
      expect(result.topMerchants[0].merchant).toBe('GROCERY STORE');
    });
  });

  describe('parseFilters', () => {
    it('parses account filter from search params', () => {
      // parseFilters uses getAll('account'), not comma-separated 'accounts'
      const params = new URLSearchParams();
      params.append('account', 'acc1');
      params.append('account', 'acc2');
      const filters = parseFilters(params);

      expect(filters.accounts).toEqual(['acc1', 'acc2']);
    });

    it('parses category filter from search params', () => {
      // parseFilters uses getAll('category'), not comma-separated 'categories'
      const params = new URLSearchParams();
      params.append('category', 'cat1');
      params.append('category', 'cat2');
      const filters = parseFilters(params);

      expect(filters.categories).toEqual(['cat1', 'cat2']);
    });

    it('parses date range from search params', () => {
      const params = new URLSearchParams('startDate=2024-01-01&endDate=2024-01-31');
      const filters = parseFilters(params);

      expect(filters.startDate).toBe('2024-01-01');
      expect(filters.endDate).toBe('2024-01-31');
    });

    it('parses merchant filter from search params', () => {
      const params = new URLSearchParams('merchant=amazon');
      const filters = parseFilters(params);

      expect(filters.merchant).toBe('amazon');
    });

    it('returns undefined for empty filters', () => {
      const params = new URLSearchParams();
      const filters = parseFilters(params);

      expect(filters.accounts).toBeUndefined();
      expect(filters.categories).toBeUndefined();
      expect(filters.merchant).toBeUndefined();
    });
  });

  describe('resolveDateRange', () => {
    it('resolves this-month preset to current month', () => {
      const now = new Date();
      const { startDate, endDate } = resolveDateRange('this-month', undefined, undefined);

      // Use UTC methods since resolveDateRange creates UTC dates
      expect(startDate.getUTCMonth()).toBe(now.getMonth());
      expect(startDate.getUTCDate()).toBe(1);
    });

    it('resolves last-month preset to previous month', () => {
      const now = new Date();
      const expectedMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const { startDate, endDate } = resolveDateRange('last-month', undefined, undefined);

      expect(startDate.getUTCMonth()).toBe(expectedMonth);
    });

    it('uses custom date range when provided', () => {
      const { startDate, endDate } = resolveDateRange('custom', '2024-01-01', '2024-01-31');

      expect(startDate.toISOString().split('T')[0]).toBe('2024-01-01');
      expect(endDate.toISOString().split('T')[0]).toBe('2024-01-31');
    });

    it('resolves last-3-months preset', () => {
      const now = new Date();
      const { startDate, endDate } = resolveDateRange('last-3-months', undefined, undefined);

      // End date should be current month
      expect(endDate.getUTCMonth()).toBe(now.getMonth());

      // Start date should be 2 months before current
      const expectedStartMonth = (now.getMonth() - 2 + 12) % 12;
      expect(startDate.getUTCMonth()).toBe(expectedStartMonth);
    });

    it('resolves ytd preset', () => {
      const now = new Date();
      const { startDate, endDate } = resolveDateRange('ytd', undefined, undefined);

      // Start date should be January 1
      expect(startDate.getUTCMonth()).toBe(0);
      expect(startDate.getUTCDate()).toBe(1);
      expect(startDate.getUTCFullYear()).toBe(now.getFullYear());
    });
  });

  describe('multi-currency support', () => {
    it('converts foreign currency to base currency', async () => {
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

      // Create EUR transaction
      await prisma.transaction.create({
        data: createTransactionData('eur-account', {
          date: now,
          amount: -100, // 100 EUR
          merchant: 'EURO STORE',
          categoryId: groceryCategoryId,
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // 100 EUR * 1.1 = 110 USD
      expect(result.netCashflow.spending).toBeCloseTo(110, 0);
    });

    it('aggregates multiple currencies correctly', async () => {
      const eurAccount = createAccountData({
        id: 'eur-account',
        name: 'Euro Account',
        currency: 'EUR',
      });
      await prisma.account.create({ data: eurAccount });

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

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: -100, // 100 USD
            merchant: 'US STORE',
            categoryId: groceryCategoryId,
          }),
          createTransactionData('eur-account', {
            date: now,
            amount: -100, // 100 EUR = 110 USD
            merchant: 'EUR STORE',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Total: 100 USD + 110 USD (converted) = 210 USD
      expect(result.netCashflow.spending).toBeCloseTo(210, 0);
    });
  });

  describe('return/offset handling', () => {
    it('reduces spending by linked returns', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // Create purchase
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          date: now,
          amount: -100,
          merchant: 'STORE',
          categoryId: groceryCategoryId,
        }),
      });

      // Create linked return
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          date: now,
          amount: 50, // Partial refund
          merchant: 'STORE REFUND',
          categoryId: groceryCategoryId,
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      // Net spending should be 100 - 50 = 50
      expect(result.netCashflow.spending).toBe(50);
    });

    it('handles full refund', async () => {
      const now = new Date();
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          date: now,
          amount: -100,
          merchant: 'STORE',
          categoryId: groceryCategoryId,
        }),
      });

      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          date: now,
          amount: 100, // Full refund
          merchant: 'STORE REFUND',
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.netCashflow.spending).toBe(0);
    });
  });

  describe('trend alerts', () => {
    it('generates alerts for significant category changes', async () => {
      const now = new Date();
      const lastMonth = subMonths(now, 1);
      const startDate = startOfMonth(now);
      const endDate = endOfMonth(now);

      // Last month: low spending
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          date: lastMonth,
          amount: -100,
          merchant: 'STORE',
          categoryId: groceryCategoryId,
        }),
      });

      // This month: much higher spending
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: now,
            amount: -500,
            merchant: 'STORE 1',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: now,
            amount: -500,
            merchant: 'STORE 2',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const result = await dashboardAnalytics(prisma, {}, startDate, endDate);

      expect(result.trendAlerts).toBeDefined();
      expect(result.trendAlerts.length).toBeGreaterThan(0);
    });
  });

  describe('buildWhere helper', () => {
    it('builds where clause with date range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const filters = {};

      const where = buildWhere(filters, startDate, endDate);

      expect(where.date.gte).toEqual(startDate);
      expect(where.date.lte).toEqual(endDate);
    });

    it('includes account filter when provided', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const filters = { accounts: ['acc1', 'acc2'] };

      const where = buildWhere(filters, startDate, endDate);

      expect(where.accountId).toEqual({ in: ['acc1', 'acc2'] });
    });

    it('includes category filter when provided', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const filters = { categories: ['cat1'] };

      const where = buildWhere(filters, startDate, endDate);

      expect(where.categoryId).toEqual({ in: ['cat1'] });
    });

    it('omits undefined filters', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const filters = {};

      const where = buildWhere(filters, startDate, endDate);

      expect(where.accountId).toBeUndefined();
      expect(where.categoryId).toBeUndefined();
      expect(where.merchant).toBeUndefined();
    });
  });
});
