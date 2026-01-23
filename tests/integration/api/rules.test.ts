import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createCategoryData, createRuleData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('rules API integration', () => {
  let prisma: PrismaClient;
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

    // Create categories for rules
    const groceryCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Groceries', type: 'expense' }),
    });
    const transportCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Transport', type: 'expense' }),
    });

    groceryCategoryId = groceryCategory.id;
    transportCategoryId = transportCategory.id;
  });

  describe('GET rules', () => {
    it('returns empty array when no rules exist', async () => {
      const rules = await prisma.rule.findMany();
      expect(rules).toHaveLength(0);
    });

    it('returns rules ordered by priority ascending', async () => {
      await prisma.rule.createMany({
        data: [
          createRuleData(transportCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'uber',
            priority: 50,
          }),
          createRuleData(transportCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'lyft',
            priority: 10,
          }),
          createRuleData(groceryCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'trader',
            priority: 30,
          }),
        ],
      });

      const rules = await prisma.rule.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });

      expect(rules).toHaveLength(3);
      expect(rules[0].matchValue).toBe('lyft'); // priority 10
      expect(rules[1].matchValue).toBe('trader'); // priority 30
      expect(rules[2].matchValue).toBe('uber'); // priority 50
    });
  });

  describe('POST rule', () => {
    it('creates merchantContains rule', async () => {
      const created = await prisma.rule.create({
        data: {
          matchType: 'merchantContains',
          matchValue: 'amazon',
          categoryId: groceryCategoryId,
          priority: 100,
          isEnabled: true,
        },
      });

      expect(created.id).toBeDefined();
      expect(created.matchType).toBe('merchantContains');
      expect(created.matchValue).toBe('amazon');
      expect(created.categoryId).toBe(groceryCategoryId);
    });

    it('creates merchantRegex rule', async () => {
      const created = await prisma.rule.create({
        data: {
          matchType: 'merchantRegex',
          matchValue: '^UBER.*TRIP',
          categoryId: transportCategoryId,
          priority: 50,
        },
      });

      expect(created.matchType).toBe('merchantRegex');
      expect(created.matchValue).toBe('^UBER.*TRIP');
    });

    it('creates noteContains rule', async () => {
      const created = await prisma.rule.create({
        data: {
          matchType: 'noteContains',
          matchValue: 'business lunch',
          categoryId: groceryCategoryId,
          priority: 75,
        },
      });

      expect(created.matchType).toBe('noteContains');
    });

    it('creates rule with custom priority', async () => {
      const created = await prisma.rule.create({
        data: {
          matchType: 'merchantContains',
          matchValue: 'test',
          categoryId: groceryCategoryId,
          priority: 1,
        },
      });

      expect(created.priority).toBe(1);
    });

    it('creates disabled rule', async () => {
      const created = await prisma.rule.create({
        data: {
          matchType: 'merchantContains',
          matchValue: 'test',
          categoryId: groceryCategoryId,
          isEnabled: false,
        },
      });

      expect(created.isEnabled).toBe(false);
    });
  });

  describe('PATCH rule', () => {
    it('updates rule matchValue', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId, {
          matchValue: 'old value',
        }),
      });

      const updated = await prisma.rule.update({
        where: { id: created.id },
        data: { matchValue: 'new value' },
      });

      expect(updated.matchValue).toBe('new value');
    });

    it('updates rule category', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId),
      });

      const updated = await prisma.rule.update({
        where: { id: created.id },
        data: { categoryId: transportCategoryId },
      });

      expect(updated.categoryId).toBe(transportCategoryId);
    });

    it('updates rule priority', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId, {
          priority: 100,
        }),
      });

      const updated = await prisma.rule.update({
        where: { id: created.id },
        data: { priority: 1 },
      });

      expect(updated.priority).toBe(1);
    });

    it('disables rule', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId, {
          isEnabled: true,
        }),
      });

      const updated = await prisma.rule.update({
        where: { id: created.id },
        data: { isEnabled: false },
      });

      expect(updated.isEnabled).toBe(false);
    });

    it('enables rule', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId, {
          isEnabled: false,
        }),
      });

      const updated = await prisma.rule.update({
        where: { id: created.id },
        data: { isEnabled: true },
      });

      expect(updated.isEnabled).toBe(true);
    });
  });

  describe('DELETE rule', () => {
    it('deletes rule', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId),
      });

      await prisma.rule.delete({ where: { id: created.id } });

      const found = await prisma.rule.findFirst({ where: { id: created.id } });
      expect(found).toBeNull();
    });
  });

  describe('rule matching logic', () => {
    it('finds rules that would match a merchant', async () => {
      await prisma.rule.createMany({
        data: [
          createRuleData(groceryCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'amazon',
            priority: 10,
          }),
          createRuleData(groceryCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'whole foods',
            priority: 20,
          }),
          createRuleData(transportCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'uber',
            priority: 30,
          }),
        ],
      });

      // Find rules that match 'AMAZON MARKETPLACE'
      const matchingRules = await prisma.rule.findMany({
        where: {
          isEnabled: true,
          matchType: 'merchantContains',
        },
        orderBy: { priority: 'asc' },
      });

      // Filter in application code (simulating the matching logic)
      const merchant = 'AMAZON MARKETPLACE';
      const matched = matchingRules.filter((rule) =>
        merchant.toLowerCase().includes(rule.matchValue.toLowerCase())
      );

      expect(matched).toHaveLength(1);
      expect(matched[0].matchValue).toBe('amazon');
    });

    it('applies priority correctly when multiple rules match', async () => {
      await prisma.rule.createMany({
        data: [
          createRuleData(groceryCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'amazon',
            priority: 100, // Lower priority
          }),
          createRuleData(transportCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'amazon fresh',
            priority: 10, // Higher priority
          }),
        ],
      });

      const matchingRules = await prisma.rule.findMany({
        where: { isEnabled: true },
        orderBy: { priority: 'asc' },
      });

      const merchant = 'AMAZON FRESH DELIVERY';
      const matched = matchingRules.filter((rule) =>
        merchant.toLowerCase().includes(rule.matchValue.toLowerCase())
      );

      // Both rules match, but 'amazon fresh' has higher priority (lower number)
      expect(matched).toHaveLength(2);
      expect(matched[0].matchValue).toBe('amazon fresh');
      expect(matched[0].priority).toBe(10);
    });

    it('ignores disabled rules', async () => {
      await prisma.rule.createMany({
        data: [
          createRuleData(groceryCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'starbucks',
            isEnabled: false, // Disabled
          }),
          createRuleData(groceryCategoryId, {
            matchType: 'merchantContains',
            matchValue: 'coffee',
            isEnabled: true,
          }),
        ],
      });

      const enabledRules = await prisma.rule.findMany({
        where: { isEnabled: true },
      });

      expect(enabledRules).toHaveLength(1);
      expect(enabledRules[0].matchValue).toBe('coffee');
    });
  });
});
