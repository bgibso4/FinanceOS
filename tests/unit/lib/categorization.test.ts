import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  normalizeMerchant,
  applyRules,
  autoCategorize,
  LOW_CONFIDENCE_THRESHOLD,
} from '@/lib/categorization';
import { setupTestDb, teardownTestDb, resetTestDb, getTestPrisma } from '../../helpers/db';
import { createCategoryData, createRuleData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('categorization', () => {
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

  describe('normalizeMerchant', () => {
    it('converts to lowercase', () => {
      expect(normalizeMerchant('STARBUCKS')).toBe('starbucks');
      expect(normalizeMerchant('Amazon.com')).toBe('amazon com');
    });

    it('removes common prefixes', () => {
      expect(normalizeMerchant('POS STARBUCKS')).toBe('starbucks');
      expect(normalizeMerchant('PURCHASE WALMART')).toBe('walmart');
      expect(normalizeMerchant('DEBIT TARGET')).toBe('target');
      expect(normalizeMerchant('CREDIT AMAZON')).toBe('amazon');
    });

    it('removes transaction codes', () => {
      // The normalization removes patterns like *ABC123 and #RIDE using regex [*#]\w+
      expect(normalizeMerchant('AMAZON.COM*ABC123')).toBe('amazon com');
      // *TRIP is removed as a transaction code (matches [*#]\w+ pattern)
      expect(normalizeMerchant('UBER *TRIP')).toBe('uber');
      // #RIDE is removed entirely as a transaction code
      expect(normalizeMerchant('LYFT #RIDE')).toBe('lyft');
    });

    it('removes long numeric sequences', () => {
      expect(normalizeMerchant('CHASE PAYMENT 1234567890')).toBe('chase payment');
    });

    it('removes common suffixes', () => {
      expect(normalizeMerchant('ACME INC')).toBe('acme');
      expect(normalizeMerchant('WIDGETS LLC')).toBe('widgets');
      expect(normalizeMerchant('STUFF CORP')).toBe('stuff');
    });

    it('removes store numbers', () => {
      expect(normalizeMerchant("TRADER JOE'S #123")).toBe('trader joe');
      expect(normalizeMerchant('WALMART 4521')).toBe('walmart');
      expect(normalizeMerchant('TARGET #0042')).toBe('target');
    });

    it('removes special characters', () => {
      expect(normalizeMerchant('COFFEE & TEA')).toBe('coffee tea');
      expect(normalizeMerchant('FOOD-MART')).toBe('food mart');
    });

    it('limits to first 3 meaningful words', () => {
      expect(normalizeMerchant('SOME VERY LONG MERCHANT NAME HERE')).toBe('some very long');
    });

    it('handles empty or whitespace input', () => {
      // Falls back to original lowercase when normalized is empty
      expect(normalizeMerchant('123')).toBe('123');
    });
  });

  describe('applyRules', () => {
    it('matches merchantContains rule', async () => {
      // Create category and rule
      const category = createCategoryData({ id: 'cat-1', name: 'Coffee', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-1', {
        matchType: 'merchantContains',
        matchValue: 'starbucks',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'STARBUCKS COFFEE', null);
      expect(result).toBe('cat-1');
    });

    it('matches merchantContains case-insensitively', async () => {
      const category = createCategoryData({ id: 'cat-2', name: 'Food', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-2', {
        matchType: 'merchantContains',
        matchValue: 'McDonalds',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'MCDONALDS #1234', null);
      expect(result).toBe('cat-2');
    });

    it('matches noteContains rule', async () => {
      const category = createCategoryData({ id: 'cat-3', name: 'Business', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-3', {
        matchType: 'noteContains',
        matchValue: 'client meeting',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'RESTAURANT XYZ', 'Lunch for client meeting');
      expect(result).toBe('cat-3');
    });

    it('matches merchantRegex rule', async () => {
      const category = createCategoryData({ id: 'cat-4', name: 'Subscriptions', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-4', {
        matchType: 'merchantRegex',
        matchValue: '^(netflix|spotify|hulu)',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      expect(await applyRules(prisma, 'NETFLIX.COM', null)).toBe('cat-4');
      expect(await applyRules(prisma, 'SPOTIFY USA', null)).toBe('cat-4');
      expect(await applyRules(prisma, 'HULU LLC', null)).toBe('cat-4');
    });

    it('respects priority ordering (lower number = higher priority)', async () => {
      const cat1 = createCategoryData({ id: 'cat-high', name: 'High Priority', type: 'expense' });
      const cat2 = createCategoryData({ id: 'cat-low', name: 'Low Priority', type: 'expense' });
      await prisma.category.createMany({ data: [cat1, cat2] });

      // Create rules - lower priority number wins
      const rule1 = createRuleData('cat-high', {
        matchType: 'merchantContains',
        matchValue: 'amazon',
        priority: 1, // Higher priority
      });
      const rule2 = createRuleData('cat-low', {
        matchType: 'merchantContains',
        matchValue: 'amazon',
        priority: 100, // Lower priority
      });
      await prisma.rule.createMany({ data: [rule1, rule2] });

      const result = await applyRules(prisma, 'AMAZON.COM', null);
      expect(result).toBe('cat-high');
    });

    it('returns null when no rules match', async () => {
      const category = createCategoryData({ id: 'cat-5', name: 'Random', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-5', {
        matchType: 'merchantContains',
        matchValue: 'specific-merchant',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'COMPLETELY DIFFERENT STORE', null);
      expect(result).toBeNull();
    });

    it('ignores disabled rules', async () => {
      const category = createCategoryData({ id: 'cat-6', name: 'Disabled', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-6', {
        matchType: 'merchantContains',
        matchValue: 'target',
        priority: 1,
        isEnabled: false,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'TARGET STORE', null);
      expect(result).toBeNull();
    });

    it('handles invalid regex gracefully', async () => {
      const category = createCategoryData({ id: 'cat-7', name: 'Regex', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-7', {
        matchType: 'merchantRegex',
        matchValue: '[invalid(regex', // Invalid regex
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      // Should not throw, just skip invalid rule
      const result = await applyRules(prisma, 'SOME MERCHANT', null);
      expect(result).toBeNull();
    });
  });

  describe('autoCategorize', () => {
    beforeEach(async () => {
      // Create standard categories for keyword catalog
      await prisma.category.createMany({
        data: [
          createCategoryData({ id: 'cat-transport', name: 'Transport', type: 'expense' }),
          createCategoryData({ id: 'cat-groceries', name: 'Groceries', type: 'expense' }),
          createCategoryData({ id: 'cat-shopping', name: 'Shopping', type: 'expense' }),
          createCategoryData({ id: 'cat-coffee', name: 'Coffee', type: 'expense' }),
          createCategoryData({ id: 'cat-entertainment', name: 'Entertainment', type: 'expense' }),
          createCategoryData({ id: 'cat-income', name: 'Income', type: 'income' }),
          createCategoryData({ id: 'cat-transfer', name: 'Transfer', type: 'transfer' }),
        ],
      });
    });

    it('applies rules with confidence 0.98', async () => {
      const rule = createRuleData('cat-coffee', {
        matchType: 'merchantContains',
        matchValue: 'philz',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await autoCategorize(prisma, 'PHILZ COFFEE', null);
      expect(result.categoryId).toBe('cat-coffee');
      expect(result.confidence).toBe(0.98);
    });

    it('falls back to keyword catalog with confidence 0.72', async () => {
      // No rules, should use keyword catalog
      const result = await autoCategorize(prisma, 'UBER *TRIP', null);
      expect(result.categoryId).toBe('cat-transport');
      expect(result.confidence).toBe(0.72);
    });

    it('matches keyword from normalized merchant', async () => {
      const result = await autoCategorize(prisma, "TRADER JOE'S #123", null);
      expect(result.categoryId).toBe('cat-groceries');
      expect(result.confidence).toBe(0.72);
    });

    it('returns null with confidence 0.3 when no match found', async () => {
      const result = await autoCategorize(prisma, 'UNKNOWN MERCHANT XYZ', null);
      expect(result.categoryId).toBeNull();
      expect(result.confidence).toBe(0.3);
    });

    it('prioritizes rules over keyword catalog', async () => {
      // Create a rule that overrides the keyword catalog
      const rule = createRuleData('cat-coffee', {
        matchType: 'merchantContains',
        matchValue: 'starbucks',
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      // Starbucks is in keyword catalog as 'Coffee', but we have a rule too
      const result = await autoCategorize(prisma, 'STARBUCKS', null);
      expect(result.categoryId).toBe('cat-coffee');
      expect(result.confidence).toBe(0.98); // Rule confidence, not keyword
    });

    it('matches multiple keywords from catalog', async () => {
      // Test various keywords
      const tests = [
        { merchant: 'LYFT *RIDE', expected: 'cat-transport' },
        { merchant: 'WHOLE FOODS', expected: 'cat-groceries' },
        { merchant: 'SAFEWAY GROCERY', expected: 'cat-groceries' },
        { merchant: 'AMAZON.COM', expected: 'cat-shopping' },
        { merchant: 'NETFLIX.COM', expected: 'cat-entertainment' },
        { merchant: 'SPOTIFY USA', expected: 'cat-entertainment' },
      ];

      for (const test of tests) {
        const result = await autoCategorize(prisma, test.merchant, null);
        expect(result.categoryId).toBe(test.expected);
        expect(result.confidence).toBe(0.72);
      }
    });
  });

  describe('LOW_CONFIDENCE_THRESHOLD', () => {
    it('exports the correct threshold value', () => {
      expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.6);
    });
  });
});
