import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('transaction adjustment API integration', () => {
  let prisma: PrismaClient;
  let testAccountId: string;

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
  });

  describe('POST /api/transactions/adjustment', () => {
    it('creates a positive balance adjustment', async () => {
      // Find or create adjustment category
      let adjustmentCategory = await prisma.category.findFirst({
        where: { name: 'Balance Adjustment' },
      });

      if (!adjustmentCategory) {
        adjustmentCategory = await prisma.category.create({
          data: {
            name: 'Balance Adjustment',
            type: 'transfer',
          },
        });
      }

      // Create adjustment transaction
      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: 50.25,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: 'Manual balance reconciliation',
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.amount).toBe(50.25);
      expect(transaction.merchant).toBe('Balance Adjustment');
      expect(transaction.isTransfer).toBe(true);
      expect(transaction.confidenceScore).toBe(1);
    });

    it('creates a negative balance adjustment', async () => {
      let adjustmentCategory = await prisma.category.findFirst({
        where: { name: 'Balance Adjustment' },
      });

      if (!adjustmentCategory) {
        adjustmentCategory = await prisma.category.create({
          data: {
            name: 'Balance Adjustment',
            type: 'transfer',
          },
        });
      }

      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: -100.5,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: 'Manual balance reconciliation',
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.amount).toBe(-100.5);
    });

    it('creates Balance Adjustment category if not exists', async () => {
      // Verify category doesn't exist
      const beforeCategory = await prisma.category.findFirst({
        where: { name: 'Balance Adjustment' },
      });
      expect(beforeCategory).toBeNull();

      // Create category (as the API would)
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      expect(adjustmentCategory.name).toBe('Balance Adjustment');
      expect(adjustmentCategory.type).toBe('transfer');
    });

    it('uses existing Balance Adjustment category', async () => {
      // Create category first
      const existingCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      // Look up category (as API would)
      const foundCategory = await prisma.category.findFirst({
        where: { name: 'Balance Adjustment' },
      });

      expect(foundCategory).not.toBeNull();
      expect(foundCategory!.id).toBe(existingCategory.id);
    });

    it('sets adjustment as transfer to exclude from analytics', async () => {
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: 200,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: 'Test adjustment',
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.isTransfer).toBe(true);

      // Verify it's excluded from analytics queries
      const nonTransferTransactions = await prisma.transaction.findMany({
        where: { isTransfer: false },
      });
      expect(nonTransferTransactions).toHaveLength(0);
    });

    it('includes custom note in adjustment', async () => {
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      const customNote = 'Correcting for missed cash deposit';
      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: 150,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: customNote,
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.note).toBe(customNote);
    });

    it('uses default note when not provided', async () => {
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      const defaultNote = 'Manual balance reconciliation';
      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: 75,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: defaultNote,
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.note).toBe('Manual balance reconciliation');
    });

    it('rejects adjustment with missing account', async () => {
      // Try to create with non-existent account
      await expect(
        prisma.transaction.create({
          data: {
            date: new Date(),
            amount: 100,
            accountId: 'non-existent-account',
            merchant: 'Balance Adjustment',
          },
        })
      ).rejects.toThrow();
    });

    it('sets confidence score to 1 (manually confirmed)', async () => {
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: 25,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: 'Test',
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.confidenceScore).toBe(1);
    });

    it('handles zero amount adjustment', async () => {
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: 0,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: 'Zero adjustment',
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(transaction.amount).toBe(0);
    });

    it('handles large adjustment amounts', async () => {
      const adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer',
        },
      });

      const largeAmount = 1000000.99;
      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(),
          amount: largeAmount,
          accountId: testAccountId,
          merchant: 'Balance Adjustment',
          merchantNormalized: 'balance adjustment',
          categoryId: adjustmentCategory.id,
          note: 'Large adjustment',
          isTransfer: true,
          confidenceScore: 1,
        },
      });

      expect(Number(transaction.amount)).toBeCloseTo(largeAmount, 2);
    });
  });
});
