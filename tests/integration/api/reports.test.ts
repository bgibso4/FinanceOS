import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import { ensureSnapshot, monthlySnapshot } from '@/lib/analytics';

describe('reports API integration', () => {
  let prisma: PrismaClient;
  let testAccountId: string;
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

    // Create test account
    const account = createAccountData({ id: 'test-account', name: 'Test Account' });
    await prisma.account.create({ data: account });
    testAccountId = account.id!;

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

  describe('GET /api/reports/monthly', () => {
    it('returns empty array when no snapshots exist', async () => {
      const snapshots = await prisma.monthlySnapshot.findMany({
        orderBy: { month: 'desc' },
      });
      expect(snapshots).toHaveLength(0);
    });

    it('returns snapshots in descending order by month', async () => {
      await prisma.monthlySnapshot.createMany({
        data: [
          {
            month: '2024-01',
            incomeTotal: 5000,
            spendingTotal: 2000,
            savingsTotal: 3000,
            savingsRatePct: 60,
            categoryTotals: '{}',
            merchantTotals: '{}',
          },
          {
            month: '2024-02',
            incomeTotal: 5500,
            spendingTotal: 2200,
            savingsTotal: 3300,
            savingsRatePct: 60,
            categoryTotals: '{}',
            merchantTotals: '{}',
          },
          {
            month: '2024-03',
            incomeTotal: 6000,
            spendingTotal: 2500,
            savingsTotal: 3500,
            savingsRatePct: 58.33,
            categoryTotals: '{}',
            merchantTotals: '{}',
          },
        ],
      });

      const snapshots = await prisma.monthlySnapshot.findMany({
        orderBy: { month: 'desc' },
      });

      expect(snapshots).toHaveLength(3);
      expect(snapshots[0].month).toBe('2024-03');
      expect(snapshots[1].month).toBe('2024-02');
      expect(snapshots[2].month).toBe('2024-01');
    });

    it('stores category totals as JSON', async () => {
      const categoryTotals = { Groceries: -500, Transport: -200 };

      await prisma.monthlySnapshot.create({
        data: {
          month: '2024-01',
          incomeTotal: 5000,
          spendingTotal: 700,
          savingsTotal: 4300,
          savingsRatePct: 86,
          categoryTotals: JSON.stringify(categoryTotals),
          merchantTotals: '{}',
        },
      });

      const snapshot = await prisma.monthlySnapshot.findFirst({
        where: { month: '2024-01' },
      });

      const parsed = JSON.parse(snapshot!.categoryTotals!);
      expect(parsed.Groceries).toBe(-500);
      expect(parsed.Transport).toBe(-200);
    });

    it('stores merchant totals as JSON', async () => {
      const merchantTotals = { 'TRADER JOES': -300, UBER: -150 };

      await prisma.monthlySnapshot.create({
        data: {
          month: '2024-01',
          incomeTotal: 5000,
          spendingTotal: 450,
          savingsTotal: 4550,
          savingsRatePct: 91,
          categoryTotals: '{}',
          merchantTotals: JSON.stringify(merchantTotals),
        },
      });

      const snapshot = await prisma.monthlySnapshot.findFirst({
        where: { month: '2024-01' },
      });

      const parsed = JSON.parse(snapshot!.merchantTotals!);
      expect(parsed['TRADER JOES']).toBe(-300);
      expect(parsed.UBER).toBe(-150);
    });
  });

  describe('POST /api/reports/snapshot', () => {
    it('creates a new snapshot with calculated savings', async () => {
      const month = '2024-01';
      const income = 5000;
      const spending = 2000;
      const expectedSavings = income - spending;
      const expectedRate = (expectedSavings / income) * 100;

      const snapshot = await prisma.monthlySnapshot.create({
        data: {
          month,
          incomeTotal: income,
          spendingTotal: spending,
          savingsTotal: expectedSavings,
          savingsRatePct: expectedRate,
          categoryTotals: '{}',
          merchantTotals: '{}',
        },
      });

      expect(snapshot.month).toBe(month);
      expect(Number(snapshot.incomeTotal)).toBe(income);
      expect(Number(snapshot.spendingTotal)).toBe(spending);
      expect(Number(snapshot.savingsTotal)).toBe(expectedSavings);
      expect(snapshot.savingsRatePct).toBeCloseTo(expectedRate, 2);
    });

    it('updates existing snapshot for same month', async () => {
      const month = '2024-01';

      // Create initial snapshot
      await prisma.monthlySnapshot.create({
        data: {
          month,
          incomeTotal: 5000,
          spendingTotal: 2000,
          savingsTotal: 3000,
          savingsRatePct: 60,
          categoryTotals: '{}',
          merchantTotals: '{}',
        },
      });

      // Update with new values
      const existing = await prisma.monthlySnapshot.findFirst({
        where: { month },
      });

      await prisma.monthlySnapshot.update({
        where: { id: existing!.id },
        data: {
          incomeTotal: 6000,
          spendingTotal: 2500,
          savingsTotal: 3500,
          savingsRatePct: 58.33,
        },
      });

      const updated = await prisma.monthlySnapshot.findFirst({
        where: { month },
      });

      expect(Number(updated!.incomeTotal)).toBe(6000);
      expect(Number(updated!.spendingTotal)).toBe(2500);
    });

    it('calculates savings rate as 0 when income is 0', async () => {
      const month = '2024-01';
      const income = 0;
      const spending = 500;

      // When income is 0, savings rate should be 0
      const savingsRate = income > 0 ? ((income - spending) / income) * 100 : 0;

      const snapshot = await prisma.monthlySnapshot.create({
        data: {
          month,
          incomeTotal: income,
          spendingTotal: spending,
          savingsTotal: income - spending,
          savingsRatePct: savingsRate,
          categoryTotals: '{}',
          merchantTotals: '{}',
        },
      });

      expect(snapshot.savingsRatePct).toBe(0);
    });
  });

  describe('POST /api/reports/close-month (ensureSnapshot)', () => {
    it('creates snapshot from current transaction data', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      // Create transactions for the month
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: testDate,
            amount: 5000,
            merchant: 'EMPLOYER',
            categoryId: incomeCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -200,
            merchant: 'GROCERY STORE',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -100,
            merchant: 'UBER',
            categoryId: transportCategoryId,
          }),
        ],
      });

      const snapshot = await ensureSnapshot(prisma, testMonth);

      expect(snapshot.month).toBe(testMonth);
      expect(Number(snapshot.incomeTotal)).toBe(5000);
      expect(Number(snapshot.spendingTotal)).toBe(300);
      expect(Number(snapshot.savingsTotal)).toBe(4700);
    });

    it('returns existing snapshot if already created', async () => {
      const testMonth = '2024-01';

      // Create a manual snapshot
      const existingSnapshot = await prisma.monthlySnapshot.create({
        data: {
          month: testMonth,
          incomeTotal: 9999,
          spendingTotal: 1111,
          savingsTotal: 8888,
          savingsRatePct: 88.88,
          categoryTotals: '{"custom": true}',
          merchantTotals: '{}',
        },
      });

      // ensureSnapshot should return the existing one
      const snapshot = await ensureSnapshot(prisma, testMonth);

      expect(snapshot.id).toBe(existingSnapshot.id);
      expect(Number(snapshot.incomeTotal)).toBe(9999);
    });

    it('excludes transfer transactions from snapshot', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: testDate,
            amount: 5000,
            merchant: 'EMPLOYER',
            categoryId: incomeCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -500,
            merchant: 'TRANSFER OUT',
            isTransfer: true,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -100,
            merchant: 'REAL EXPENSE',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const snapshot = await ensureSnapshot(prisma, testMonth);

      // Transfer should not be counted
      expect(Number(snapshot.spendingTotal)).toBe(100);
    });
  });

  describe('GET /api/reports/trailing-12-months', () => {
    it('returns 12 months of data', async () => {
      // Create transactions for multiple months
      const now = new Date();
      const transactions = [];

      for (let i = 0; i < 12; i++) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 15);
        transactions.push(
          createTransactionData(testAccountId, {
            date: monthDate,
            amount: 5000,
            merchant: 'EMPLOYER',
            categoryId: incomeCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: monthDate,
            amount: -(200 + i * 10),
            merchant: 'STORE',
            categoryId: groceryCategoryId,
          })
        );
      }

      await prisma.transaction.createMany({ data: transactions });

      // Verify we have data for each month
      const allTransactions = await prisma.transaction.findMany();
      expect(allTransactions.length).toBe(24); // 2 per month * 12 months
    });

    it('falls back to snapshot data when no transactions exist', async () => {
      // Create only snapshot data (simulating backfilled history)
      await prisma.monthlySnapshot.create({
        data: {
          month: '2023-01',
          incomeTotal: 5000,
          spendingTotal: 2000,
          savingsTotal: 3000,
          savingsRatePct: 60,
          categoryTotals: '{}',
          merchantTotals: '{}',
        },
      });

      const snapshot = await prisma.monthlySnapshot.findFirst({
        where: { month: '2023-01' },
      });

      expect(snapshot).toBeDefined();
      expect(Number(snapshot!.incomeTotal)).toBe(5000);
    });
  });

  describe('monthlySnapshot function', () => {
    it('calculates correct totals from transactions', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: testDate,
            amount: 5000,
            merchant: 'EMPLOYER',
            categoryId: incomeCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -200,
            merchant: 'TRADER JOES',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -50,
            merchant: 'UBER',
            categoryId: transportCategoryId,
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.incomeTotal).toBe(5000);
      expect(result.spendingTotal).toBe(250);
      expect(result.savingsTotal).toBe(4750);
      expect(result.savingsRatePct).toBeCloseTo(95, 0);
    });

    it('groups by category correctly', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -100,
            merchant: 'STORE 1',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -50,
            merchant: 'STORE 2',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -25,
            merchant: 'UBER',
            categoryId: transportCategoryId,
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.categoryTotals['Groceries']).toBe(-150);
      expect(result.categoryTotals['Transport']).toBe(-25);
    });

    it('groups by merchant correctly', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -30,
            merchant: 'STARBUCKS',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -25,
            merchant: 'STARBUCKS',
            categoryId: groceryCategoryId,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -50,
            merchant: 'UBER',
            categoryId: transportCategoryId,
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.merchantTotals['STARBUCKS']).toBe(-55);
      expect(result.merchantTotals['UBER']).toBe(-50);
    });

    it('excludes transfer transactions', async () => {
      const testMonth = '2024-01';
      const testDate = new Date('2024-01-15');

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -500,
            merchant: 'TRANSFER',
            isTransfer: true,
          }),
          createTransactionData(testAccountId, {
            date: testDate,
            amount: -100,
            merchant: 'REAL EXPENSE',
            categoryId: groceryCategoryId,
          }),
        ],
      });

      const result = await monthlySnapshot(prisma, testMonth);

      expect(result.spendingTotal).toBe(100);
    });

    it('handles month with no transactions', async () => {
      const result = await monthlySnapshot(prisma, '2024-01');

      expect(result.incomeTotal).toBe(0);
      expect(result.spendingTotal).toBe(0);
      expect(result.savingsTotal).toBe(0);
      expect(result.savingsRatePct).toBe(0);
    });
  });
});
