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
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'uber' },
            ]),
            priority: 50,
          }),
          createRuleData(transportCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'lyft' },
            ]),
            priority: 10,
          }),
          createRuleData(groceryCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'trader' },
            ]),
            priority: 30,
          }),
        ],
      });

      const rules = await prisma.rule.findMany({
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });

      expect(rules).toHaveLength(3);
      expect(JSON.parse(rules[0].conditions)[0].value).toBe('lyft'); // priority 10
      expect(JSON.parse(rules[1].conditions)[0].value).toBe('trader'); // priority 30
      expect(JSON.parse(rules[2].conditions)[0].value).toBe('uber'); // priority 50
    });
  });

  describe('POST rule', () => {
    it('creates merchant contains rule', async () => {
      const created = await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'amazon' },
          ]),
          categoryId: groceryCategoryId,
          priority: 100,
          isEnabled: true,
        },
      });

      expect(created.id).toBeDefined();
      const conditions = JSON.parse(created.conditions);
      expect(conditions[0].field).toBe('merchant');
      expect(conditions[0].operator).toBe('contains');
      expect(conditions[0].value).toBe('amazon');
      expect(created.categoryId).toBe(groceryCategoryId);
    });

    it('creates merchant regex rule', async () => {
      const created = await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'regex', value: '^UBER.*TRIP' },
          ]),
          categoryId: transportCategoryId,
          priority: 50,
        },
      });

      const conditions = JSON.parse(created.conditions);
      expect(conditions[0].operator).toBe('regex');
      expect(conditions[0].value).toBe('^UBER.*TRIP');
    });

    it('creates note contains rule', async () => {
      const created = await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'note', operator: 'contains', value: 'business lunch' },
          ]),
          categoryId: groceryCategoryId,
          priority: 75,
        },
      });

      const conditions = JSON.parse(created.conditions);
      expect(conditions[0].field).toBe('note');
      expect(conditions[0].operator).toBe('contains');
    });

    it('creates rule with custom priority', async () => {
      const created = await prisma.rule.create({
        data: {
          conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'test' }]),
          categoryId: groceryCategoryId,
          priority: 1,
        },
      });

      expect(created.priority).toBe(1);
    });

    it('creates disabled rule', async () => {
      const created = await prisma.rule.create({
        data: {
          conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'test' }]),
          categoryId: groceryCategoryId,
          isEnabled: false,
        },
      });

      expect(created.isEnabled).toBe(false);
    });
  });

  describe('PATCH rule', () => {
    it('updates rule conditions', async () => {
      const created = await prisma.rule.create({
        data: createRuleData(groceryCategoryId, {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'old value' },
          ]),
        }),
      });

      const newConditions = JSON.stringify([
        { field: 'merchant', operator: 'contains', value: 'new value' },
      ]);
      const updated = await prisma.rule.update({
        where: { id: created.id },
        data: { conditions: newConditions },
      });

      expect(JSON.parse(updated.conditions)[0].value).toBe('new value');
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
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'amazon' },
            ]),
            priority: 10,
          }),
          createRuleData(groceryCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'whole foods' },
            ]),
            priority: 20,
          }),
          createRuleData(transportCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'uber' },
            ]),
            priority: 30,
          }),
        ],
      });

      // Find all enabled rules
      const matchingRules = await prisma.rule.findMany({
        where: {
          isEnabled: true,
        },
        orderBy: { priority: 'asc' },
      });

      // Filter in application code (simulating the matching logic)
      const merchant = 'AMAZON MARKETPLACE';
      const matched = matchingRules.filter((rule) => {
        const conditions = JSON.parse(rule.conditions);
        return conditions.some(
          (c: { field: string; operator: string; value: string }) =>
            c.field === 'merchant' &&
            c.operator === 'contains' &&
            merchant.toLowerCase().includes(c.value.toLowerCase())
        );
      });

      expect(matched).toHaveLength(1);
      expect(JSON.parse(matched[0].conditions)[0].value).toBe('amazon');
    });

    it('applies priority correctly when multiple rules match', async () => {
      await prisma.rule.createMany({
        data: [
          createRuleData(groceryCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'amazon' },
            ]),
            priority: 100, // Lower priority
          }),
          createRuleData(transportCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'amazon fresh' },
            ]),
            priority: 10, // Higher priority
          }),
        ],
      });

      const matchingRules = await prisma.rule.findMany({
        where: { isEnabled: true },
        orderBy: { priority: 'asc' },
      });

      const merchant = 'AMAZON FRESH DELIVERY';
      const matched = matchingRules.filter((rule) => {
        const conditions = JSON.parse(rule.conditions);
        return conditions.some(
          (c: { field: string; operator: string; value: string }) =>
            c.field === 'merchant' &&
            c.operator === 'contains' &&
            merchant.toLowerCase().includes(c.value.toLowerCase())
        );
      });

      // Both rules match, but 'amazon fresh' has higher priority (lower number)
      expect(matched).toHaveLength(2);
      expect(JSON.parse(matched[0].conditions)[0].value).toBe('amazon fresh');
      expect(matched[0].priority).toBe(10);
    });

    it('ignores disabled rules', async () => {
      await prisma.rule.createMany({
        data: [
          createRuleData(groceryCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'starbucks' },
            ]),
            isEnabled: false, // Disabled
          }),
          createRuleData(groceryCategoryId, {
            conditions: JSON.stringify([
              { field: 'merchant', operator: 'contains', value: 'coffee' },
            ]),
            isEnabled: true,
          }),
        ],
      });

      const enabledRules = await prisma.rule.findMany({
        where: { isEnabled: true },
      });

      expect(enabledRules).toHaveLength(1);
      expect(JSON.parse(enabledRules[0].conditions)[0].value).toBe('coffee');
    });
  });
});
