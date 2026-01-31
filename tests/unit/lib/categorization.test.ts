import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  normalizeMerchant,
  applyRules,
  autoCategorize,
  LOW_CONFIDENCE_THRESHOLD,
} from '@/lib/categorization';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
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

    it('removes common transaction prefixes', () => {
      expect(normalizeMerchant('POS STARBUCKS')).toBe('starbucks');
      expect(normalizeMerchant('PURCHASE WALMART')).toBe('walmart');
      expect(normalizeMerchant('DEBIT TARGET')).toBe('target');
      expect(normalizeMerchant('CREDIT AMAZON')).toBe('amazon');
      expect(normalizeMerchant('CHECK CARD COSTCO')).toBe('costco');
      expect(normalizeMerchant('VISA WHOLE FOODS')).toBe('whole foods');
      expect(normalizeMerchant('MASTERCARD BEST BUY')).toBe('best buy');
    });

    it('removes card-level prefixes (CL *, SQ *, TST *, PP *)', () => {
      expect(normalizeMerchant('CL *Chase Travel')).toBe('chase travel');
      expect(normalizeMerchant('SQ *COFFEE SHOP')).toBe('coffee shop');
      expect(normalizeMerchant('TST* Test Restaurant')).toBe('test restaurant');
      expect(normalizeMerchant('PP *PAYPAL MERCHANT')).toBe('paypal merchant');
      // Without space
      expect(normalizeMerchant('CL*MERCHANT NAME')).toBe('merchant name');
      // Should NOT remove common merchant names like UBER, LYFT
      expect(normalizeMerchant('UBER *TRIP')).toBe('uber trip');
      expect(normalizeMerchant('LYFT *RIDE')).toBe('lyft ride');
    });

    it('removes PayPal prefixes', () => {
      expect(normalizeMerchant('PAYPAL *UBER')).toBe('uber');
      expect(normalizeMerchant('PAYPAL*SPOTIFY')).toBe('spotify');
    });

    it('handles special characters (*, #, -, /, etc)', () => {
      // Transaction codes (alphanumeric with numbers) after * or # are removed
      expect(normalizeMerchant('AMAZON.COM*ABC123')).toBe('amazon com');
      // Pure letter codes are kept (TRIP, RIDE are likely part of merchant name)
      expect(normalizeMerchant('UBER *TRIP')).toBe('uber trip');
      expect(normalizeMerchant('LYFT #RIDE')).toBe('lyft ride');
      // Other special characters become spaces
      expect(normalizeMerchant('FOOD-MART')).toBe('food mart');
      expect(normalizeMerchant('COFFEE & TEA')).toBe('coffee tea');
      expect(normalizeMerchant('STORE/LOCATION')).toBe('store location');
      expect(normalizeMerchant("JOE'S PIZZA")).toBe('joe pizza');
      expect(normalizeMerchant('MERCHANT (ONLINE)')).toBe('merchant online');
      expect(normalizeMerchant('COMPANY@WEB')).toBe('company web');
    });

    it('removes long numeric sequences (transaction IDs)', () => {
      expect(normalizeMerchant('CHASE PAYMENT 1234567890')).toBe('chase payment');
      expect(normalizeMerchant('TRANSFER 98765432109876')).toBe('transfer');
    });

    it('removes short transaction codes at start/end', () => {
      expect(normalizeMerchant('12 MERCHANT NAME')).toBe('merchant name');
      expect(normalizeMerchant('MERCHANT NAME 99')).toBe('merchant name');
    });

    it('removes common business suffixes', () => {
      expect(normalizeMerchant('ACME INC')).toBe('acme');
      expect(normalizeMerchant('WIDGETS LLC')).toBe('widgets');
      expect(normalizeMerchant('STUFF CORP')).toBe('stuff');
      expect(normalizeMerchant('TECH COMPANY')).toBe('tech');
      expect(normalizeMerchant('FOOD SERVICE')).toBe('food');
      // "RESTAURANT" is not in the suffix list, so it's kept
      // This is intentional - we only remove legal entity suffixes, not descriptive words
      expect(normalizeMerchant('PIZZA RESTAURANT')).toBe('pizza restaurant');
    });

    it('removes store/location numbers', () => {
      expect(normalizeMerchant("TRADER JOE'S #123")).toBe('trader joe');
      expect(normalizeMerchant('WALMART 4521')).toBe('walmart');
      expect(normalizeMerchant('TARGET #0042')).toBe('target');
      // The "store" word is kept but the number is removed
      // This is fine for matching - isMerchantSimilar handles "costco" vs "costco store"
      expect(normalizeMerchant('COSTCO STORE 123')).toBe('costco store');
    });

    it('limits to first 3 meaningful words', () => {
      expect(normalizeMerchant('SOME VERY LONG MERCHANT NAME HERE')).toBe('some very long');
    });

    it('handles empty or whitespace input', () => {
      // Falls back to basic cleanup when normalized is empty
      expect(normalizeMerchant('123')).toBe('123');
      expect(normalizeMerchant('   ')).toBe('');
    });

    // Real-world test cases that should work
    describe('real-world merchant names', () => {
      it('handles Chase credit card transactions', () => {
        expect(normalizeMerchant('CHASE Travel')).toBe('chase travel');
        expect(normalizeMerchant('CL *Chase Travel')).toBe('chase travel');
        expect(normalizeMerchant('CHASE')).toBe('chase');
      });

      it('handles common retailers', () => {
        expect(normalizeMerchant('AMAZON.COM*1A2B3C')).toBe('amazon com');
        // "US" (2 chars) is filtered out as a short word, but "MKTP" (4 chars) stays
        // Transaction code is removed, leaving just "amzn"
        // The 3-word limit takes first 3 significant words
        expect(normalizeMerchant('AMZN MKTP US*AB1CD2EF3')).toBe('amzn');
        expect(normalizeMerchant('WAL-MART #1234 CITY ST')).toBe('wal mart');
        expect(normalizeMerchant('TARGET 00012345')).toBe('target');
      });

      it('handles rideshare and delivery', () => {
        // "HELP" is kept as a 4-letter meaningful word (3-word limit applies)
        expect(normalizeMerchant('UBER *TRIP HELP.UBER.COM')).toBe('uber trip help');
        // "THU" is 3 chars (the threshold), "5PM" is removed as numeric
        // 3-word limit takes "lyft ride thu"
        expect(normalizeMerchant('LYFT *RIDE THU 5PM')).toBe('lyft ride thu');
        expect(normalizeMerchant('DOORDASH*CHIPOTLE')).toBe('doordash chipotle');
        expect(normalizeMerchant('GRUBHUB ORDER 123456789')).toBe('grubhub order');
      });

      it('handles subscription services', () => {
        // Phone numbers are kept as they help identify the merchant
        expect(normalizeMerchant('NETFLIX.COM 866-579-7172')).toBe('netflix com 866');
        expect(normalizeMerchant('SPOTIFY USA 877-778-8798')).toBe('spotify usa 877');
        expect(normalizeMerchant('APPLE.COM/BILL ONE APPLE PARK')).toBe('apple com bill');
      });

      it('handles Square/point-of-sale transactions', () => {
        expect(normalizeMerchant('SQ *LOCAL COFFEE')).toBe('local coffee');
        // "THE" is kept as part of merchant name
        expect(normalizeMerchant('SQ *THE SANDWICH SHOP')).toBe('the sandwich shop');
        expect(normalizeMerchant('SQUARE *FARMERS MARKET')).toBe('square farmers market');
      });

      it('handles bank transfers and payments', () => {
        // "PAYMENT" is removed as a transaction prefix, leaving "FROM"
        // The isMerchantSimilar function handles matching these variations
        expect(normalizeMerchant('PAYMENT FROM - *****01*20 81')).toBe('from');
        expect(normalizeMerchant('Customer Transfer Dr. MB-CREDIT CARD/LOC PAY.')).toBe(
          'customer transfer credit'
        );
        // "CHK" is 3 letters so it's kept, but short numeric is removed
        // 3-word limit takes "online transfer chk"
        expect(normalizeMerchant('ONLINE TRANSFER TO CHK 1234')).toBe('online transfer chk');
        // "CO" suffix is removed as a common business suffix
        expect(normalizeMerchant('ACH DEBIT INSURANCE CO')).toBe('ach debit insurance');
      });

      it('handles international/foreign transactions', () => {
        expect(normalizeMerchant('FOREIGN TRANSACTION FEE')).toBe('foreign transaction fee');
        // City/state suffix "LONDON GB" is removed as it's not part of merchant identity
        expect(normalizeMerchant('GOOGLE *SERVICES LONDON GB')).toBe('google services');
      });
    });
  });

  describe('applyRules', () => {
    it('matches merchant contains rule', async () => {
      // Create category and rule
      const category = createCategoryData({ id: 'cat-1', name: 'Coffee', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-1', {
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'contains', value: 'starbucks' },
        ]),
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'STARBUCKS COFFEE', null);
      expect(result.categoryId).toBe('cat-1');
      expect(result.renameTo).toBeNull();
    });

    it('matches merchant contains case-insensitively', async () => {
      const category = createCategoryData({ id: 'cat-2', name: 'Food', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-2', {
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'contains', value: 'McDonalds' },
        ]),
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'MCDONALDS #1234', null);
      expect(result.categoryId).toBe('cat-2');
    });

    it('matches note contains rule', async () => {
      const category = createCategoryData({ id: 'cat-3', name: 'Business', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-3', {
        conditions: JSON.stringify([
          { field: 'note', operator: 'contains', value: 'client meeting' },
        ]),
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'RESTAURANT XYZ', 'Lunch for client meeting');
      expect(result.categoryId).toBe('cat-3');
    });

    it('matches merchant regex rule', async () => {
      const category = createCategoryData({ id: 'cat-4', name: 'Subscriptions', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-4', {
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'regex', value: '^(netflix|spotify|hulu)' },
        ]),
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      expect((await applyRules(prisma, 'NETFLIX.COM', null)).categoryId).toBe('cat-4');
      expect((await applyRules(prisma, 'SPOTIFY USA', null)).categoryId).toBe('cat-4');
      expect((await applyRules(prisma, 'HULU LLC', null)).categoryId).toBe('cat-4');
    });

    it('respects priority ordering (lower number = higher priority)', async () => {
      const cat1 = createCategoryData({ id: 'cat-high', name: 'High Priority', type: 'expense' });
      const cat2 = createCategoryData({ id: 'cat-low', name: 'Low Priority', type: 'expense' });
      await prisma.category.createMany({ data: [cat1, cat2] });

      // Create rules - lower priority number wins
      const rule1 = createRuleData('cat-high', {
        conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'amazon' }]),
        priority: 1, // Higher priority
      });
      const rule2 = createRuleData('cat-low', {
        conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'amazon' }]),
        priority: 100, // Lower priority
      });
      await prisma.rule.createMany({ data: [rule1, rule2] });

      const result = await applyRules(prisma, 'AMAZON.COM', null);
      expect(result.categoryId).toBe('cat-high');
    });

    it('returns null categoryId when no rules match', async () => {
      const category = createCategoryData({ id: 'cat-5', name: 'Random', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-5', {
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'contains', value: 'specific-merchant' },
        ]),
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'COMPLETELY DIFFERENT STORE', null);
      expect(result.categoryId).toBeNull();
      expect(result.renameTo).toBeNull();
    });

    it('ignores disabled rules', async () => {
      const category = createCategoryData({ id: 'cat-6', name: 'Disabled', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-6', {
        conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'target' }]),
        priority: 1,
        isEnabled: false,
      });
      await prisma.rule.create({ data: rule });

      const result = await applyRules(prisma, 'TARGET STORE', null);
      expect(result.categoryId).toBeNull();
    });

    it('handles invalid regex gracefully', async () => {
      const category = createCategoryData({ id: 'cat-7', name: 'Regex', type: 'expense' });
      await prisma.category.create({ data: category });

      const rule = createRuleData('cat-7', {
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'regex', value: '[invalid(regex' },
        ]),
        priority: 1,
      });
      await prisma.rule.create({ data: rule });

      // Should not throw, just skip invalid rule
      const result = await applyRules(prisma, 'SOME MERCHANT', null);
      expect(result.categoryId).toBeNull();
    });

    it('returns renameTo when rule has it', async () => {
      const category = createCategoryData({ id: 'cat-8', name: 'Transfer', type: 'expense' });
      await prisma.category.create({ data: category });

      await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'ENDING' },
          ]),
          categoryId: 'cat-8',
          renameTo: 'Internal Transfer',
          priority: 1,
          isEnabled: true,
        },
      });

      const result = await applyRules(prisma, 'ENDING', null);
      expect(result.categoryId).toBe('cat-8');
      expect(result.renameTo).toBe('Internal Transfer');
    });

    it('returns renameTo without categoryId for rename-only rules', async () => {
      await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'CRYPTIC_CODE' },
          ]),
          categoryId: null,
          renameTo: 'Friendly Name',
          priority: 1,
          isEnabled: true,
        },
      });

      const result = await applyRules(prisma, 'CRYPTIC_CODE_123', null);
      expect(result.categoryId).toBeNull();
      expect(result.renameTo).toBe('Friendly Name');
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
          createCategoryData({ id: 'cat-subscriptions', name: 'Subscriptions', type: 'expense' }),
          createCategoryData({ id: 'cat-income', name: 'Income', type: 'income' }),
          createCategoryData({ id: 'cat-transfer', name: 'Transfer', type: 'transfer' }),
        ],
      });
    });

    it('applies rules with confidence 0.98', async () => {
      const rule = createRuleData('cat-coffee', {
        conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'philz' }]),
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
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'contains', value: 'starbucks' },
        ]),
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
        { merchant: 'NETFLIX.COM', expected: 'cat-subscriptions' },
        { merchant: 'SPOTIFY USA', expected: 'cat-subscriptions' },
      ];

      for (const test of tests) {
        const result = await autoCategorize(prisma, test.merchant, null);
        expect(result.categoryId).toBe(test.expected);
        expect(result.confidence).toBe(0.72);
      }
    });

    it('returns renameTo from matching rule', async () => {
      await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'ENDING' },
          ]),
          categoryId: 'cat-transfer',
          renameTo: 'Internal Transfer',
          priority: 1,
          isEnabled: true,
        },
      });

      const result = await autoCategorize(prisma, 'ENDING', null);
      expect(result.categoryId).toBe('cat-transfer');
      expect(result.confidence).toBe(0.98);
      expect(result.renameTo).toBe('Internal Transfer');
    });

    it('returns renameTo even when category comes from keyword catalog', async () => {
      // Rule with only renameTo (no category)
      await prisma.rule.create({
        data: {
          conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'uber' }]),
          categoryId: null,
          renameTo: 'Uber Ride',
          priority: 1,
          isEnabled: true,
        },
      });

      const result = await autoCategorize(prisma, 'UBER *TRIP', null);
      // Category comes from keyword catalog (Transport)
      expect(result.categoryId).toBe('cat-transport');
      expect(result.confidence).toBe(0.72); // Keyword catalog confidence
      expect(result.renameTo).toBe('Uber Ride'); // Rename from rule
    });
  });

  describe('LOW_CONFIDENCE_THRESHOLD', () => {
    it('exports the correct threshold value', () => {
      expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.6);
    });
  });
});
