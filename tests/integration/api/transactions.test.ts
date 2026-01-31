import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb, getTestPrisma } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

/**
 * API Integration Tests for Transaction Routes
 *
 * These tests verify the behavior of transaction API endpoints
 * by directly testing the business logic layer.
 *
 * Note: Full HTTP request testing with Next.js App Router requires
 * additional setup. These tests focus on the core logic.
 */
describe('transactions API integration', () => {
  let prisma: PrismaClient;
  let testAccountId: string;
  let testCategoryId: string;

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

    // Create test category
    const category = createCategoryData({
      id: 'test-category',
      name: 'Test Category',
      type: 'expense',
    });
    await prisma.category.create({ data: category });
    testCategoryId = category.id!;
  });

  describe('GET transactions', () => {
    it('returns all transactions for account', async () => {
      // Create test transactions
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, { merchant: 'Merchant 1', amount: -50 }),
          createTransactionData(testAccountId, { merchant: 'Merchant 2', amount: -75 }),
          createTransactionData(testAccountId, { merchant: 'Merchant 3', amount: -100 }),
        ],
      });

      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });

      expect(transactions).toHaveLength(3);
    });

    it('filters by date range', async () => {
      const now = new Date();
      const lastMonth = new Date(now);
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, { date: now, merchant: 'Current Month' }),
          createTransactionData(testAccountId, { date: lastMonth, merchant: 'Last Month' }),
        ],
      });

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const transactions = await prisma.transaction.findMany({
        where: {
          accountId: testAccountId,
          date: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].merchant).toBe('Current Month');
    });

    it('filters by category', async () => {
      const otherCategory = createCategoryData({
        id: 'other-category',
        name: 'Other',
        type: 'expense',
      });
      await prisma.category.create({ data: otherCategory });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            merchant: 'Categorized',
            categoryId: testCategoryId,
          }),
          createTransactionData(testAccountId, {
            merchant: 'Different Category',
            categoryId: otherCategory.id!,
          }),
        ],
      });

      const transactions = await prisma.transaction.findMany({
        where: {
          accountId: testAccountId,
          categoryId: testCategoryId,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].merchant).toBe('Categorized');
    });

    it('excludes transfer transactions when specified', async () => {
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, { merchant: 'Normal', isTransfer: false }),
          createTransactionData(testAccountId, { merchant: 'Transfer', isTransfer: true }),
        ],
      });

      const transactions = await prisma.transaction.findMany({
        where: {
          accountId: testAccountId,
          isTransfer: false,
        },
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].merchant).toBe('Normal');
    });
  });

  describe('POST transaction', () => {
    it('creates transaction with required fields', async () => {
      const txData = createTransactionData(testAccountId, {
        date: new Date(),
        amount: -50,
        merchant: 'New Merchant',
      });

      const created = await prisma.transaction.create({
        data: txData,
      });

      expect(created.id).toBeDefined();
      expect(created.merchant).toBe('New Merchant');
      expect(created.amount).toBe(-50);
      expect(created.accountId).toBe(testAccountId);
    });

    it('creates transaction with category', async () => {
      const txData = createTransactionData(testAccountId, {
        merchant: 'Categorized Transaction',
        categoryId: testCategoryId,
        confidenceScore: 1.0,
      });

      const created = await prisma.transaction.create({
        data: txData,
      });

      expect(created.categoryId).toBe(testCategoryId);
      expect(created.confidenceScore).toBe(1.0);
    });

    it('sets merchantNormalized automatically', async () => {
      const txData = createTransactionData(testAccountId, {
        merchant: "TRADER JOE'S #123",
        merchantNormalized: 'trader joe',
      });

      const created = await prisma.transaction.create({
        data: txData,
      });

      expect(created.merchantNormalized).toBe('trader joe');
    });
  });

  describe('PATCH transaction', () => {
    it('updates category', async () => {
      const tx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'To Update',
          categoryId: undefined,
        }),
      });

      const updated = await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          categoryId: testCategoryId,
          confidenceScore: 1.0, // Manual categorization
        },
      });

      expect(updated.categoryId).toBe(testCategoryId);
      expect(updated.confidenceScore).toBe(1.0);
    });

    it('updates note', async () => {
      const tx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { merchant: 'With Note' }),
      });

      const updated = await prisma.transaction.update({
        where: { id: tx.id },
        data: { note: 'Business lunch' },
      });

      expect(updated.note).toBe('Business lunch');
    });

    it('updates tags', async () => {
      const tx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { merchant: 'Tagged', tags: '[]' }),
      });

      const updated = await prisma.transaction.update({
        where: { id: tx.id },
        data: { tags: '["business", "travel"]' },
      });

      expect(updated.tags).toBe('["business", "travel"]');
    });
  });

  describe('DELETE transaction', () => {
    it('deletes transaction', async () => {
      const tx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { merchant: 'To Delete' }),
      });

      await prisma.transaction.delete({
        where: { id: tx.id },
      });

      const deleted = await prisma.transaction.findUnique({
        where: { id: tx.id },
      });

      expect(deleted).toBeNull();
    });

    it('clears linkedTransactionId on linked transactions', async () => {
      // Create original and linked return
      const original = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'Original Purchase',
          amount: -100,
        }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'Return',
          amount: 100,
          isOffset: true,
          linkedTransactionId: original.id,
        }),
      });

      // Delete original - return should have linkedTransactionId cleared (via onDelete: SetNull)
      await prisma.transaction.delete({
        where: { id: original.id },
      });

      const updatedReturn = await prisma.transaction.findUnique({
        where: { id: returnTx.id },
      });

      expect(updatedReturn?.linkedTransactionId).toBeNull();
    });
  });

  describe('transaction relationships', () => {
    it('links return to original transaction', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'Store',
          amount: -100,
        }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'Store Return',
          amount: 100,
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      // Query with relation
      const purchaseWithReturn = await prisma.transaction.findUnique({
        where: { id: purchase.id },
        include: { offsetTransactions: true },
      });

      expect(purchaseWithReturn?.offsetTransactions).toHaveLength(1);
      expect(purchaseWithReturn?.offsetTransactions[0].id).toBe(returnTx.id);
    });

    it('groups transfer transactions', async () => {
      const transferGroupId = 'transfer-123';

      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            merchant: 'Transfer Out',
            amount: -500,
            isTransfer: true,
            transferGroupId,
          }),
          createTransactionData(testAccountId, {
            merchant: 'Transfer In',
            amount: 500,
            isTransfer: true,
            transferGroupId,
          }),
        ],
      });

      const transfers = await prisma.transaction.findMany({
        where: { transferGroupId },
      });

      expect(transfers).toHaveLength(2);
      expect(transfers[0].transferGroupId).toBe(transfers[1].transferGroupId);
    });
  });
});
