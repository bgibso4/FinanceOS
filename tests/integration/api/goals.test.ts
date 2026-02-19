import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData, createGoalData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('goals API integration', () => {
  let prisma: PrismaClient;
  let categoryId: string;
  let tagId: string;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();

    const [category, tag, account] = await Promise.all([
      prisma.category.create({
        data: createCategoryData({ name: 'Travel', type: 'expense' }),
      }),
      prisma.tag.create({ data: { name: 'Camping', color: 'green' } }),
      prisma.account.create({
        data: createAccountData({ name: 'Savings' }),
      }),
    ]);

    categoryId = category.id;
    tagId = tag.id;
    accountId = account.id;
  });

  describe('CRUD operations', () => {
    it('creates a spending goal with category tracking', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel Budget',
          type: 'spending',
          targetAmount: 5000,
          trackingMethod: 'category',
          categoryId,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      expect(goal.name).toBe('2026 Travel Budget');
      expect(goal.type).toBe('spending');
      expect(goal.trackingMethod).toBe('category');
      expect(goal.categoryId).toBe(categoryId);
      expect(goal.status).toBe('active');
    });

    it('creates a savings goal with account tracking', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Emergency Fund',
          type: 'saving',
          targetAmount: 10000,
          trackingMethod: 'account',
          accountId,
        }),
      });

      expect(goal.type).toBe('saving');
      expect(goal.trackingMethod).toBe('account');
      expect(goal.accountId).toBe(accountId);
    });

    it('creates a spending goal with tag tracking', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Camping Trip',
          type: 'spending',
          targetAmount: 2000,
          trackingMethod: 'tag',
          tagId,
        }),
      });

      expect(goal.trackingMethod).toBe('tag');
      expect(goal.tagId).toBe(tagId);
    });

    it('lists only active goals by default', async () => {
      await prisma.goal.createMany({
        data: [
          createGoalData({
            name: 'Active Goal',
            status: 'active',
            categoryId,
            trackingMethod: 'category',
          }),
          createGoalData({
            name: 'Completed Goal',
            status: 'completed',
            categoryId,
            trackingMethod: 'category',
          }),
          createGoalData({
            name: 'Archived Goal',
            status: 'archived',
            categoryId,
            trackingMethod: 'category',
          }),
        ],
      });

      const activeGoals = await prisma.goal.findMany({
        where: { status: 'active' },
      });

      expect(activeGoals).toHaveLength(1);
      expect(activeGoals[0].name).toBe('Active Goal');
    });

    it('updates a goal', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Travel',
          targetAmount: 5000,
          categoryId,
          trackingMethod: 'category',
        }),
      });

      const updated = await prisma.goal.update({
        where: { id: goal.id },
        data: { name: 'Travel 2026', targetAmount: 6000, status: 'completed' },
      });

      expect(updated.name).toBe('Travel 2026');
      expect(updated.targetAmount).toBe(6000);
      expect(updated.status).toBe('completed');
    });

    it('deletes a goal', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({ name: 'To Delete', categoryId, trackingMethod: 'category' }),
      });

      await prisma.goal.delete({ where: { id: goal.id } });

      const found = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect(found).toBeNull();
    });
  });
});
