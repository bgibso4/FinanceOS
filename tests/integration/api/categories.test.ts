import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createCategoryData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('categories API integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  describe('GET categories', () => {
    it('returns empty array when no categories exist', async () => {
      const categories = await prisma.category.findMany();
      expect(categories).toHaveLength(0);
    });

    it('returns all categories ordered by name', async () => {
      await prisma.category.createMany({
        data: [
          createCategoryData({ name: 'Groceries', type: 'expense' }),
          createCategoryData({ name: 'Income', type: 'income' }),
          createCategoryData({ name: 'Entertainment', type: 'expense' }),
        ],
      });

      const categories = await prisma.category.findMany({
        orderBy: { name: 'asc' },
      });

      expect(categories).toHaveLength(3);
      expect(categories[0].name).toBe('Entertainment');
      expect(categories[1].name).toBe('Groceries');
      expect(categories[2].name).toBe('Income');
    });
  });

  describe('POST category', () => {
    it('creates expense category', async () => {
      const created = await prisma.category.create({
        data: {
          name: 'Groceries',
          type: 'expense',
        },
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Groceries');
      expect(created.type).toBe('expense');
    });

    it('creates income category', async () => {
      const created = await prisma.category.create({
        data: {
          name: 'Salary',
          type: 'income',
        },
      });

      expect(created.type).toBe('income');
    });

    it('creates transfer category', async () => {
      const created = await prisma.category.create({
        data: {
          name: 'Account Transfer',
          type: 'transfer',
        },
      });

      expect(created.type).toBe('transfer');
    });

    it('creates subcategory with parent', async () => {
      // Create parent category
      const parent = await prisma.category.create({
        data: { name: 'Food & Dining', type: 'expense' },
      });

      // Create subcategory
      const subcategory = await prisma.category.create({
        data: {
          name: 'Restaurants',
          type: 'expense',
          parentId: parent.id,
        },
      });

      expect(subcategory.parentId).toBe(parent.id);
    });
  });

  describe('PATCH category', () => {
    it('updates category name', async () => {
      const created = await prisma.category.create({
        data: createCategoryData({ name: 'Old Name' }),
      });

      const updated = await prisma.category.update({
        where: { id: created.id },
        data: { name: 'New Name' },
      });

      expect(updated.name).toBe('New Name');
    });

    it('updates category type', async () => {
      const created = await prisma.category.create({
        data: createCategoryData({ type: 'expense' }),
      });

      const updated = await prisma.category.update({
        where: { id: created.id },
        data: { type: 'income' },
      });

      expect(updated.type).toBe('income');
    });

    it('assigns parent to existing category', async () => {
      const parent = await prisma.category.create({
        data: createCategoryData({ name: 'Parent' }),
      });

      const child = await prisma.category.create({
        data: createCategoryData({ name: 'Child' }),
      });

      const updated = await prisma.category.update({
        where: { id: child.id },
        data: { parentId: parent.id },
      });

      expect(updated.parentId).toBe(parent.id);
    });

    it('removes parent from category', async () => {
      const parent = await prisma.category.create({
        data: createCategoryData({ name: 'Parent' }),
      });

      const child = await prisma.category.create({
        data: { ...createCategoryData({ name: 'Child' }), parentId: parent.id },
      });

      const updated = await prisma.category.update({
        where: { id: child.id },
        data: { parentId: null },
      });

      expect(updated.parentId).toBeNull();
    });
  });

  describe('DELETE category', () => {
    it('deletes category', async () => {
      const created = await prisma.category.create({
        data: createCategoryData({}),
      });

      await prisma.category.delete({ where: { id: created.id } });

      const found = await prisma.category.findFirst({ where: { id: created.id } });
      expect(found).toBeNull();
    });

    it('nullifies categoryId on transactions when category deleted', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Test Category' }),
      });

      const account = await prisma.account.create({
        data: { name: 'Test Account', type: 'checking' },
      });

      await prisma.transaction.create({
        data: {
          accountId: account.id,
          categoryId: category.id,
          date: new Date(),
          amount: -50,
          merchant: 'Test',
          merchantNormalized: 'test',
        },
      });

      await prisma.category.delete({ where: { id: category.id } });

      const transaction = await prisma.transaction.findFirst({
        where: { accountId: account.id },
      });
      expect(transaction?.categoryId).toBeNull();
    });
  });

  describe('category hierarchy', () => {
    it('fetches category with children', async () => {
      const parent = await prisma.category.create({
        data: createCategoryData({ name: 'Food & Dining' }),
      });

      await prisma.category.createMany({
        data: [
          { ...createCategoryData({ name: 'Groceries' }), parentId: parent.id },
          { ...createCategoryData({ name: 'Restaurants' }), parentId: parent.id },
          { ...createCategoryData({ name: 'Coffee Shops' }), parentId: parent.id },
        ],
      });

      const children = await prisma.category.findMany({
        where: { parentId: parent.id },
      });

      expect(children).toHaveLength(3);
    });

    it('fetches category with parent', async () => {
      const parent = await prisma.category.create({
        data: createCategoryData({ name: 'Food & Dining' }),
      });

      const child = await prisma.category.create({
        data: { ...createCategoryData({ name: 'Groceries' }), parentId: parent.id },
      });

      const result = await prisma.category.findFirst({
        where: { id: child.id },
        include: { parent: true },
      });

      expect(result?.parent?.name).toBe('Food & Dining');
    });
  });

  describe('category transaction count', () => {
    it('counts transactions per category', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Groceries' }),
      });

      const account = await prisma.account.create({
        data: { name: 'Test Account', type: 'checking' },
      });

      // Create 3 transactions in this category
      await prisma.transaction.createMany({
        data: [
          {
            accountId: account.id,
            categoryId: category.id,
            date: new Date(),
            amount: -50,
            merchant: 'Store 1',
            merchantNormalized: 'store 1',
          },
          {
            accountId: account.id,
            categoryId: category.id,
            date: new Date(),
            amount: -75,
            merchant: 'Store 2',
            merchantNormalized: 'store 2',
          },
          {
            accountId: account.id,
            categoryId: category.id,
            date: new Date(),
            amount: -25,
            merchant: 'Store 3',
            merchantNormalized: 'store 3',
          },
        ],
      });

      const count = await prisma.transaction.count({
        where: { categoryId: category.id },
      });

      expect(count).toBe(3);
    });
  });
});
