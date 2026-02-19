import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createGoalData,
  createTransactionData,
  createCategoryHierarchy,
} from '../../helpers/factories';
import { calculateGoalProgress } from '@/lib/goals';
import type { PrismaClient } from '@prisma/client';

describe('calculateGoalProgress', () => {
  let prisma: PrismaClient;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    const account = await prisma.account.create({
      data: createAccountData({ name: 'Checking' }),
    });
    accountId = account.id;
  });

  describe('category tracking', () => {
    it('sums spending for a leaf category within date range', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Travel', type: 'expense' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel',
          type: 'spending',
          targetAmount: 5000,
          trackingMethod: 'category',
          categoryId: category.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -200,
            categoryId: category.id,
            date: new Date('2026-03-15'),
          }),
          createTransactionData(accountId, {
            amount: -300,
            categoryId: category.id,
            date: new Date('2026-06-01'),
          }),
          // Outside date range — should NOT count
          createTransactionData(accountId, {
            amount: -100,
            categoryId: category.id,
            date: new Date('2025-12-15'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(500);
      expect(progress.percentage).toBeCloseTo(10);
      expect(progress.remaining).toBe(4500);
    });

    it('sums spending across all children of a category group', async () => {
      const { parent, children } = createCategoryHierarchy('Travel', [
        'Flights',
        'Hotels',
        'Car Rental',
      ]);
      await prisma.category.create({ data: parent });
      for (const child of children) {
        await prisma.category.create({ data: child });
      }

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel',
          type: 'spending',
          targetAmount: 5000,
          trackingMethod: 'category',
          categoryId: parent.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -400,
            categoryId: children[0].id,
            date: new Date('2026-02-01'),
          }),
          createTransactionData(accountId, {
            amount: -600,
            categoryId: children[1].id,
            date: new Date('2026-03-01'),
          }),
          createTransactionData(accountId, {
            amount: -200,
            categoryId: children[2].id,
            date: new Date('2026-04-01'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(1200);
      expect(progress.percentage).toBeCloseTo(24);
    });
  });

  describe('tag tracking', () => {
    it('sums spending for transactions with matching tag', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'Camping Trip', color: 'green' },
      });

      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Travel' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Ontario Camping Trip',
          type: 'spending',
          targetAmount: 2000,
          trackingMethod: 'tag',
          tagId: tag.id,
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -150,
            categoryId: category.id,
            tags: JSON.stringify(['Camping Trip']),
            date: new Date('2026-05-01'),
          }),
          createTransactionData(accountId, {
            amount: -300,
            categoryId: category.id,
            tags: JSON.stringify(['Camping Trip', 'Outdoor']),
            date: new Date('2026-05-15'),
          }),
          // No matching tag — should NOT count
          createTransactionData(accountId, {
            amount: -50,
            categoryId: category.id,
            tags: JSON.stringify(['Outdoor']),
            date: new Date('2026-05-20'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(450);
      expect(progress.percentage).toBeCloseTo(22.5);
    });
  });

  describe('account tracking', () => {
    it('uses account balance for savings goal progress', async () => {
      // Create transactions to build up a balance
      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: 5000,
            merchant: 'Paycheck',
            date: new Date('2026-01-15'),
          }),
          createTransactionData(accountId, {
            amount: 2000,
            merchant: 'Paycheck',
            date: new Date('2026-02-15'),
          }),
        ],
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Emergency Fund',
          type: 'saving',
          targetAmount: 10000,
          trackingMethod: 'account',
          accountId: accountId,
        }),
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(7000);
      expect(progress.percentage).toBeCloseTo(70);
      expect(progress.remaining).toBe(3000);
    });
  });

  describe('open-ended goals', () => {
    it('includes all transactions when no date range is set', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Wedding' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Wedding',
          type: 'spending',
          targetAmount: 15000,
          trackingMethod: 'category',
          categoryId: category.id,
          // No startDate or endDate
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -1000,
            categoryId: category.id,
            date: new Date('2025-06-01'),
          }),
          createTransactionData(accountId, {
            amount: -2000,
            categoryId: category.id,
            date: new Date('2026-03-01'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(3000);
    });
  });

  describe('pace status', () => {
    it('returns "ahead" for spending goal under pace', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Travel' }),
      });

      // Goal: $12,000 for 2026. At mid-year, should have spent $6,000 to be on pace.
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel',
          type: 'spending',
          targetAmount: 12000,
          trackingMethod: 'category',
          categoryId: category.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      // Spent only $2,000 by mid-year — under pace (good for spending)
      await prisma.transaction.create({
        data: createTransactionData(accountId, {
          amount: -2000,
          categoryId: category.id,
          date: new Date('2026-03-01'),
        }),
      });

      const progress = await calculateGoalProgress(goal, prisma, new Date('2026-07-01'));
      expect(progress.paceStatus).toBe('ahead');
    });

    it('returns null for open-ended goals', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Wedding' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Wedding',
          type: 'spending',
          targetAmount: 15000,
          trackingMethod: 'category',
          categoryId: category.id,
        }),
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.paceStatus).toBeNull();
    });
  });
});
