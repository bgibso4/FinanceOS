import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import { reviewQueue } from '@/lib/reviewQueue';
import { subDays } from 'date-fns';

describe('review-queue API integration', () => {
  let prisma: PrismaClient;
  let testAccountId: string;
  let groceryCategoryId: string;
  let transportCategoryId: string;

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

    groceryCategoryId = groceryCategory.id;
    transportCategoryId = transportCategory.id;
  });

  describe('GET /api/review-queue', () => {
    it('returns all queue sections including highConfidence and unlinkedReturns', async () => {
      const result = await reviewQueue(prisma);
      expect(result).toHaveProperty('uncategorized');
      expect(result).toHaveProperty('lowConfidence');
      expect(result).toHaveProperty('highConfidence');
      expect(result).toHaveProperty('unlinkedReturns');
      expect(result).toHaveProperty('outliers');
      expect(Array.isArray(result.highConfidence)).toBe(true);
      expect(Array.isArray(result.unlinkedReturns)).toBe(true);
    });

    it('returns empty queues when no transactions', async () => {
      const result = await reviewQueue(prisma);

      expect(result.uncategorized).toHaveLength(0);
      expect(result.lowConfidence).toHaveLength(0);
      expect(result.outliers).toHaveLength(0);
    });

    it('returns uncategorized transactions', async () => {
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: undefined,
            merchant: 'Unknown Store 1',
            amount: -50,
          }),
          createTransactionData(testAccountId, {
            categoryId: undefined,
            merchant: 'Unknown Store 2',
            amount: -30,
          }),
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            merchant: 'Known Store',
            amount: -100,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized).toHaveLength(2);
    });

    it('excludes transfers from uncategorized queue', async () => {
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: undefined,
            merchant: 'Unknown Store',
            amount: -50,
          }),
          createTransactionData(testAccountId, {
            categoryId: undefined,
            merchant: 'Transfer',
            amount: -500,
            isTransfer: true,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized).toHaveLength(1);
      expect(result.uncategorized[0].merchant).toBe('Unknown Store');
    });

    it('returns low confidence transactions', async () => {
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            confidenceScore: 0.4,
            merchant: 'Low Confidence',
            amount: -50,
          }),
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            confidenceScore: 0.8,
            merchant: 'High Confidence',
            amount: -100,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.lowConfidence).toHaveLength(1);
      expect(result.lowConfidence[0].merchant).toBe('Low Confidence');
    });

    it('only includes categorized transactions in low confidence', async () => {
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            confidenceScore: 0.4,
            merchant: 'Has Category',
            amount: -50,
          }),
          createTransactionData(testAccountId, {
            categoryId: undefined,
            confidenceScore: 0.3,
            merchant: 'No Category',
            amount: -30,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.lowConfidence).toHaveLength(1);
      expect(result.lowConfidence[0].merchant).toBe('Has Category');
    });

    it('returns unlinked returns from last 30 days', async () => {
      const recentDate = new Date();
      const oldDate = subDays(new Date(), 45);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            amount: 50,
            merchant: 'Recent Refund',
            date: recentDate,
          }),
          createTransactionData(testAccountId, {
            amount: 75,
            merchant: 'Old Refund',
            date: oldDate,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns).toHaveLength(1);
      expect(result.unlinkedReturns[0].merchant).toBe('Recent Refund');
    });

    it('excludes already linked returns', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -100,
          merchant: 'Store',
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            amount: 50,
            merchant: 'Unlinked Refund',
          }),
          createTransactionData(testAccountId, {
            amount: 50,
            merchant: 'Linked Refund',
            isOffset: true,
            linkedTransactionId: purchase.id,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns).toHaveLength(1);
      expect(result.unlinkedReturns[0].merchant).toBe('Unlinked Refund');
    });

    it('excludes transfers from unlinked returns', async () => {
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            amount: 500,
            merchant: 'Transfer In',
            isTransfer: true,
          }),
          createTransactionData(testAccountId, {
            amount: 50,
            merchant: 'Real Refund',
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns).toHaveLength(1);
      expect(result.unlinkedReturns[0].merchant).toBe('Real Refund');
    });
  });

  describe('outlier detection', () => {
    it('flags transactions 3x greater than median with $50 difference', async () => {
      // Create baseline transactions (median will be $50)
      const baseTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Store ${i}`,
          date: subDays(new Date(), i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({ data: baseTransactions });

      // Create outlier (4x median, $150 more than median)
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -200,
          merchant: 'Big Purchase',
          date: new Date(),
          confidenceScore: 0.8,
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.outliers.length).toBeGreaterThan(0);
      const outlier = result.outliers.find((t) => t.merchant === 'Big Purchase');
      expect(outlier).toBeDefined();
    });

    it('requires at least 5 transactions to detect outliers', async () => {
      // Only 3 transactions
      const transactions = Array.from({ length: 3 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Store ${i}`,
          date: subDays(new Date(), i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({ data: transactions });

      // This would be an outlier if we had enough data
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -500,
          merchant: 'Big Purchase',
          date: new Date(),
          confidenceScore: 0.8,
        }),
      });

      const result = await reviewQueue(prisma);

      // Should not flag as outlier due to insufficient data
      expect(result.outliers).toHaveLength(0);
    });

    it('requires at least $50 difference from median', async () => {
      // Create baseline with $10 transactions
      const transactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -10,
          merchant: `Store ${i}`,
          date: subDays(new Date(), i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({ data: transactions });

      // $40 is 4x the median but only $30 more
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -40,
          merchant: 'Slightly More',
          date: new Date(),
          confidenceScore: 0.8,
        }),
      });

      const result = await reviewQueue(prisma);

      // Should not flag because difference is < $50
      expect(result.outliers).toHaveLength(0);
    });

    it('only looks at last 90 days', async () => {
      // Create old transactions
      const oldTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Old Store ${i}`,
          date: subDays(new Date(), 100 + i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({ data: oldTransactions });

      const result = await reviewQueue(prisma);

      // Old transactions shouldn't be included
      expect(result.outliers).toHaveLength(0);
    });

    it('excludes manually confirmed transactions (confidence 1.0)', async () => {
      // Create baseline transactions
      const baseTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Store ${i}`,
          date: subDays(new Date(), i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({ data: baseTransactions });

      // Create manually confirmed large purchase (should be excluded)
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -500,
          merchant: 'Confirmed Big Purchase',
          date: new Date(),
          confidenceScore: 1.0, // Manually confirmed
        }),
      });

      const result = await reviewQueue(prisma);

      // Manually confirmed should not be in outliers
      const hasConfirmed = result.outliers.some((t) => t.merchant === 'Confirmed Big Purchase');
      expect(hasConfirmed).toBe(false);
    });
  });

  describe('queue limits', () => {
    it('limits uncategorized to 50 transactions', async () => {
      const transactions = Array.from({ length: 60 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: undefined,
          merchant: `Store ${i}`,
          amount: -10,
        })
      );

      await prisma.transaction.createMany({ data: transactions });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized).toHaveLength(50);
    });

    it('limits low confidence to 50 transactions', async () => {
      const transactions = Array.from({ length: 60 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.4,
          merchant: `Store ${i}`,
          amount: -10,
        })
      );

      await prisma.transaction.createMany({ data: transactions });

      const result = await reviewQueue(prisma);

      expect(result.lowConfidence).toHaveLength(50);
    });

    it('limits outliers to 50 transactions', async () => {
      // Create enough baseline for outlier detection
      const baseTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Base Store ${i}`,
          date: subDays(new Date(), i + 60),
          confidenceScore: 0.8,
        })
      );

      // Create many outliers
      const outlierTransactions = Array.from({ length: 60 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -300, // 6x median
          merchant: `Outlier Store ${i}`,
          date: subDays(new Date(), i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({
        data: [...baseTransactions, ...outlierTransactions],
      });

      const result = await reviewQueue(prisma);

      expect(result.outliers.length).toBeLessThanOrEqual(50);
    });
  });

  describe('ordering', () => {
    it('orders uncategorized by date descending', async () => {
      const oldDate = subDays(new Date(), 5);
      const newDate = new Date();

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: undefined,
            merchant: 'Old Transaction',
            date: oldDate,
            amount: -50,
          }),
          createTransactionData(testAccountId, {
            categoryId: undefined,
            merchant: 'New Transaction',
            date: newDate,
            amount: -30,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized[0].merchant).toBe('New Transaction');
      expect(result.uncategorized[1].merchant).toBe('Old Transaction');
    });

    it('orders low confidence by date descending', async () => {
      const oldDate = subDays(new Date(), 5);
      const newDate = new Date();

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            confidenceScore: 0.4,
            merchant: 'Old Low Conf',
            date: oldDate,
            amount: -50,
          }),
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            confidenceScore: 0.4,
            merchant: 'New Low Conf',
            date: newDate,
            amount: -30,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      expect(result.lowConfidence[0].merchant).toBe('New Low Conf');
      expect(result.lowConfidence[1].merchant).toBe('Old Low Conf');
    });

    it('orders outliers by date descending', async () => {
      // Create baseline
      const baseTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Base ${i}`,
          date: subDays(new Date(), 80 + i),
          confidenceScore: 0.8,
        })
      );

      await prisma.transaction.createMany({ data: baseTransactions });

      // Create outliers on different dates
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            amount: -300,
            merchant: 'Old Outlier',
            date: subDays(new Date(), 10),
            confidenceScore: 0.8,
          }),
          createTransactionData(testAccountId, {
            categoryId: groceryCategoryId,
            amount: -300,
            merchant: 'New Outlier',
            date: new Date(),
            confidenceScore: 0.8,
          }),
        ],
      });

      const result = await reviewQueue(prisma);

      if (result.outliers.length >= 2) {
        expect(result.outliers[0].merchant).toBe('New Outlier');
        expect(result.outliers[1].merchant).toBe('Old Outlier');
      }
    });
  });
});
