import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { reviewQueue } from '@/lib/reviewQueue';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import { subDays } from 'date-fns';

describe('reviewQueue', () => {
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

    // Create a test account
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

  describe('uncategorized transactions', () => {
    it('returns transactions without category', async () => {
      // Create uncategorized transaction
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: undefined,
          merchant: 'Unknown Store',
          amount: -50,
        }),
      });

      // Create categorized transaction
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          merchant: 'Grocery Store',
          amount: -75,
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized.length).toBe(1);
      expect(result.uncategorized[0].merchant).toBe('Unknown Store');
    });

    it('excludes transfer transactions', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: undefined,
          merchant: 'Transfer',
          isTransfer: true,
          amount: -500,
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized.length).toBe(0);
    });

    it('orders by date descending', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: undefined,
          merchant: 'Old Transaction',
          date: subDays(new Date(), 10),
          amount: -50,
        }),
      });

      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: undefined,
          merchant: 'New Transaction',
          date: new Date(),
          amount: -75,
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized[0].merchant).toBe('New Transaction');
      expect(result.uncategorized[1].merchant).toBe('Old Transaction');
    });

    it('limits to 50 transactions', async () => {
      // Create 60 uncategorized transactions
      const transactions = Array.from({ length: 60 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: undefined,
          merchant: `Store ${i}`,
          amount: -10,
        })
      );

      await prisma.transaction.createMany({ data: transactions });

      const result = await reviewQueue(prisma);

      expect(result.uncategorized.length).toBe(50);
    });
  });

  describe('low confidence transactions', () => {
    it('returns transactions with confidence < 0.6', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.5, // Low confidence
          merchant: 'Low Conf',
          amount: -50,
        }),
      });

      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.8, // High confidence
          merchant: 'High Conf',
          amount: -75,
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.lowConfidence.length).toBe(1);
      expect(result.lowConfidence[0].merchant).toBe('Low Conf');
    });

    it('only includes transactions with a category', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: undefined, // No category
          confidenceScore: 0.3,
          merchant: 'Uncategorized',
          amount: -50,
        }),
      });

      const result = await reviewQueue(prisma);

      // Should not appear in lowConfidence (goes to uncategorized instead)
      const hasUncategorized = result.lowConfidence.some((t) => t.categoryId === null);
      expect(hasUncategorized).toBe(false);
    });

    it('excludes transfer transactions', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.3,
          isTransfer: true,
          merchant: 'Transfer',
          amount: -500,
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.lowConfidence.length).toBe(0);
    });
  });

  describe('high confidence transactions', () => {
    it('returns transactions with confidence >= 0.6 (created recently)', async () => {
      // Note: highConfidence filters by createdAt (not date) which is auto-set to now
      // So both transactions will be created "now" and will be in the 7-day window
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.8,
          merchant: 'High Confidence',
          date: new Date(),
          amount: -50,
        }),
      });

      // Low confidence - should not appear
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.5,
          merchant: 'Low Confidence',
          date: new Date(),
          amount: -75,
        }),
      });

      const result = await reviewQueue(prisma);

      // Only the high confidence one should appear
      expect(result.highConfidence.length).toBe(1);
      expect(result.highConfidence[0].merchant).toBe('High Confidence');
    });

    it('only includes transactions with a category', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          confidenceScore: 0.8,
          merchant: 'Has Category',
          amount: -50,
        }),
      });

      const result = await reviewQueue(prisma);

      const allHaveCategory = result.highConfidence.every((t) => t.categoryId !== null);
      expect(allHaveCategory).toBe(true);
    });
  });

  describe('unlinked returns', () => {
    it('returns positive amount transactions from last 30 days', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50, // Positive = potential return
          merchant: 'Refund',
          date: new Date(),
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns.length).toBe(1);
      expect(result.unlinkedReturns[0].amount).toBe(50);
    });

    it('excludes transactions older than 30 days', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50,
          merchant: 'Old Refund',
          date: subDays(new Date(), 45), // 45 days ago
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns.length).toBe(0);
    });

    it('excludes transactions already marked as offset', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50,
          merchant: 'Linked Refund',
          isOffset: true, // Already linked
          date: new Date(),
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns.length).toBe(0);
    });

    it('excludes transactions with linkedTransactionId', async () => {
      // First create a transaction to link to
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -100,
          merchant: 'Original Purchase',
          date: new Date(),
        }),
      });

      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50,
          merchant: 'Linked Refund',
          linkedTransactionId: purchase.id,
          date: new Date(),
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns.length).toBe(0);
    });

    it('excludes transfer transactions', async () => {
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 500, // Positive
          merchant: 'Transfer In',
          isTransfer: true,
          date: new Date(),
        }),
      });

      const result = await reviewQueue(prisma);

      expect(result.unlinkedReturns.length).toBe(0);
    });
  });

  describe('outliers', () => {
    it('flags transactions 3x greater than median for category', async () => {
      // Create baseline transactions for category
      const baseTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50, // $50 each
          merchant: `Store ${i}`,
          date: subDays(new Date(), i),
          confidenceScore: 0.8,
        })
      );
      await prisma.transaction.createMany({ data: baseTransactions });

      // Create an outlier (3x median = $150)
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -200, // 4x the median, should be flagged
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

    it('requires at least 5 transactions in category to detect outliers', async () => {
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
      expect(result.outliers.length).toBe(0);
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
      expect(result.outliers.length).toBe(0);
    });

    it('only looks at last 90 days', async () => {
      // Create old transactions
      const oldTransactions = Array.from({ length: 10 }, (_, i) =>
        createTransactionData(testAccountId, {
          categoryId: groceryCategoryId,
          amount: -50,
          merchant: `Old Store ${i}`,
          date: subDays(new Date(), 100 + i), // More than 90 days ago
          confidenceScore: 0.8,
        })
      );
      await prisma.transaction.createMany({ data: oldTransactions });

      const result = await reviewQueue(prisma);

      // Old transactions shouldn't be included
      expect(result.outliers.length).toBe(0);
    });
  });

  describe('combined results', () => {
    it('returns all queue types', async () => {
      const result = await reviewQueue(prisma);

      expect(result).toHaveProperty('uncategorized');
      expect(result).toHaveProperty('lowConfidence');
      expect(result).toHaveProperty('highConfidence');
      expect(result).toHaveProperty('unlinkedReturns');
      expect(result).toHaveProperty('outliers');
    });

    it('returns arrays even when empty', async () => {
      const result = await reviewQueue(prisma);

      expect(Array.isArray(result.uncategorized)).toBe(true);
      expect(Array.isArray(result.lowConfidence)).toBe(true);
      expect(Array.isArray(result.highConfidence)).toBe(true);
      expect(Array.isArray(result.unlinkedReturns)).toBe(true);
      expect(Array.isArray(result.outliers)).toBe(true);
    });
  });
});
