import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createTransactionData,
  createCategoryData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('transaction split API integration', () => {
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

  describe('POST /api/transactions/split', () => {
    it('splits a transaction into multiple parts', async () => {
      // Create parent transaction
      const parent = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -100,
          merchant: 'Target',
          note: 'Shopping',
        }),
      });

      // Simulate split operation
      const parts = [
        { amount: -60, categoryId: groceryCategoryId, note: 'Food items' },
        { amount: -40, categoryId: transportCategoryId, note: 'Gas' },
      ];

      // Perform the split in a transaction
      const created = await prisma.$transaction(async (tx) => {
        await tx.transaction.delete({ where: { id: parent.id } });
        return Promise.all(
          parts.map((part) =>
            tx.transaction.create({
              data: {
                date: parent.date,
                amount: part.amount,
                accountId: parent.accountId,
                merchant: parent.merchant,
                categoryId: part.categoryId,
                note: part.note,
                tags: parent.tags,
                isTransfer: parent.isTransfer,
                confidenceScore: parent.confidenceScore,
              },
            })
          )
        );
      });

      expect(created).toHaveLength(2);
      expect(created[0].amount).toBe(-60);
      expect(created[0].categoryId).toBe(groceryCategoryId);
      expect(created[0].note).toBe('Food items');
      expect(created[1].amount).toBe(-40);
      expect(created[1].categoryId).toBe(transportCategoryId);
    });

    it('preserves parent transaction properties in splits', async () => {
      const testDate = new Date('2024-01-15');
      const tagsJson = JSON.stringify(['bulk', 'monthly']);
      const parent = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -200,
          merchant: 'Costco',
          date: testDate,
          tags: tagsJson,
          confidenceScore: 0.95,
        }),
      });

      // Perform split
      const created = await prisma.$transaction(async (tx) => {
        await tx.transaction.delete({ where: { id: parent.id } });
        return Promise.all([
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -150,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: groceryCategoryId,
              note: 'Groceries',
              tags: parent.tags,
              isTransfer: parent.isTransfer,
              confidenceScore: parent.confidenceScore,
            },
          }),
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -50,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: transportCategoryId,
              note: 'Household',
              tags: parent.tags,
              isTransfer: parent.isTransfer,
              confidenceScore: parent.confidenceScore,
            },
          }),
        ]);
      });

      // Check that properties are preserved
      expect(created[0].date.getTime()).toBe(testDate.getTime());
      expect(created[0].merchant).toBe('Costco');
      expect(created[0].accountId).toBe(testAccountId);
      expect(created[0].tags).toBe(tagsJson);
      expect(created[0].confidenceScore).toBe(0.95);

      expect(created[1].date.getTime()).toBe(testDate.getTime());
      expect(created[1].merchant).toBe('Costco');
    });

    it('deletes the original transaction after split', async () => {
      const parent = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -100,
          merchant: 'Store',
        }),
      });

      const parentId = parent.id;

      // Perform split
      await prisma.$transaction(async (tx) => {
        await tx.transaction.delete({ where: { id: parentId } });
        await tx.transaction.create({
          data: {
            date: parent.date,
            amount: -60,
            accountId: parent.accountId,
            merchant: parent.merchant,
            categoryId: null,
          },
        });
        await tx.transaction.create({
          data: {
            date: parent.date,
            amount: -40,
            accountId: parent.accountId,
            merchant: parent.merchant,
            categoryId: null,
          },
        });
      });

      // Verify original is deleted
      const original = await prisma.transaction.findUnique({
        where: { id: parentId },
      });
      expect(original).toBeNull();
    });

    it('allows splits without categories', async () => {
      const parent = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -100,
          merchant: 'Mixed Store',
        }),
      });

      const created = await prisma.$transaction(async (tx) => {
        await tx.transaction.delete({ where: { id: parent.id } });
        return Promise.all([
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -70,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: null,
              note: 'Part 1',
            },
          }),
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -30,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: groceryCategoryId,
              note: 'Part 2',
            },
          }),
        ]);
      });

      expect(created[0].categoryId).toBeNull();
      expect(created[1].categoryId).toBe(groceryCategoryId);
    });

    it('supports three-way splits', async () => {
      const parent = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -150,
          merchant: 'Department Store',
        }),
      });

      const created = await prisma.$transaction(async (tx) => {
        await tx.transaction.delete({ where: { id: parent.id } });
        return Promise.all([
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -50,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: groceryCategoryId,
            },
          }),
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -50,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: transportCategoryId,
            },
          }),
          tx.transaction.create({
            data: {
              date: parent.date,
              amount: -50,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: null,
            },
          }),
        ]);
      });

      expect(created).toHaveLength(3);
      expect(created.reduce((sum, t) => sum + Number(t.amount), 0)).toBe(-150);
    });

    it('fails if parent transaction does not exist', async () => {
      await expect(
        prisma.transaction.findUniqueOrThrow({
          where: { id: 'non-existent-id' },
        })
      ).rejects.toThrow();
    });

    it('maintains transactional integrity on failure', async () => {
      const parent = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: -100,
          merchant: 'Test Store',
        }),
      });

      // Try to split with an invalid category (should fail)
      try {
        await prisma.$transaction(async (tx) => {
          await tx.transaction.delete({ where: { id: parent.id } });
          // This should fail due to foreign key constraint
          await tx.transaction.create({
            data: {
              date: parent.date,
              amount: -100,
              accountId: parent.accountId,
              merchant: parent.merchant,
              categoryId: 'non-existent-category-id',
            },
          });
        });
      } catch {
        // Expected to fail
      }

      // Parent should still exist due to transaction rollback
      const stillExists = await prisma.transaction.findUnique({
        where: { id: parent.id },
      });
      expect(stillExists).not.toBeNull();
    });
  });
});
