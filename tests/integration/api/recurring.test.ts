import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import {
  detectRecurringTransactions,
  syncDetectedRecurring,
  getRecurringSummary,
} from '@/lib/recurring';
import type { PrismaClient } from '@prisma/client';

/**
 * Integration Tests for Recurring Transaction Detection
 *
 * Tests the full detection pipeline: DB query → grouping → strategy →
 * persistence, as well as CRUD operations on recurring records.
 */
describe('recurring transactions integration', () => {
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
    const account = createAccountData({ id: 'test-account', name: 'Test Checking' });
    await prisma.account.create({ data: account });
    testAccountId = account.id!;

    // Create test category
    const category = createCategoryData({
      id: 'test-category',
      name: 'Subscriptions',
      type: 'expense',
    });
    await prisma.category.create({ data: category });
    testCategoryId = category.id!;
  });

  // ==========================================================================
  // Detection Pipeline
  // ==========================================================================

  describe('detectRecurringTransactions', () => {
    it('detects monthly subscription from transaction data', async () => {
      // Insert 6 months of Netflix transactions
      const txs = Array.from({ length: 6 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
          categoryId: testCategoryId,
        })
      );
      await prisma.transaction.createMany({ data: txs });

      const detected = await detectRecurringTransactions(prisma, testAccountId);

      expect(detected.length).toBeGreaterThanOrEqual(1);
      const netflix = detected.find((d) => d.merchantPattern === 'netflix');
      expect(netflix).toBeDefined();
      expect(netflix!.frequency).toBe('monthly');
      expect(netflix!.expectedAmount).toBeCloseTo(15.99, 1);
      expect(netflix!.accountId).toBe(testAccountId);
    });

    it('detects multiple subscriptions for the same account', async () => {
      // Netflix monthly
      const netflixTxs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
        })
      );

      // Spotify monthly
      const spotifyTxs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Spotify',
          merchantNormalized: 'spotify',
          amount: -9.99,
          date: new Date(Date.UTC(2024, i, 1)),
        })
      );

      await prisma.transaction.createMany({ data: [...netflixTxs, ...spotifyTxs] });

      const detected = await detectRecurringTransactions(prisma, testAccountId);

      expect(detected.length).toBeGreaterThanOrEqual(2);
      const merchants = detected.map((d) => d.merchantPattern);
      expect(merchants).toContain('netflix');
      expect(merchants).toContain('spotify');
    });

    it('filters by accountId when provided', async () => {
      // Create second account
      const account2 = createAccountData({ id: 'test-account-2', name: 'Credit Card' });
      await prisma.account.create({ data: account2 });

      // Netflix on account 1
      const netflixTxs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
        })
      );

      // Spotify on account 2
      const spotifyTxs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(account2.id!, {
          merchant: 'Spotify',
          merchantNormalized: 'spotify',
          amount: -9.99,
          date: new Date(Date.UTC(2024, i, 1)),
        })
      );

      await prisma.transaction.createMany({ data: [...netflixTxs, ...spotifyTxs] });

      // Only detect for account 1
      const detected = await detectRecurringTransactions(prisma, testAccountId);
      const merchants = detected.map((d) => d.merchantPattern);
      expect(merchants).toContain('netflix');
      expect(merchants).not.toContain('spotify');
    });

    it('skips transfers and offset transactions', async () => {
      // Regular monthly subscription
      const regularTxs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
          isTransfer: false,
          isOffset: false,
        })
      );

      // Transfer transactions (monthly but should be ignored)
      const transferTxs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Savings Transfer',
          merchantNormalized: 'savings transfer',
          amount: -500,
          date: new Date(Date.UTC(2024, i, 1)),
          isTransfer: true,
        })
      );

      await prisma.transaction.createMany({ data: [...regularTxs, ...transferTxs] });

      const detected = await detectRecurringTransactions(prisma, testAccountId);
      const merchants = detected.map((d) => d.merchantPattern);
      expect(merchants).not.toContain('savings transfer');
    });

    it('returns empty array when no recurring patterns found', async () => {
      // Random one-off transactions
      await prisma.transaction.createMany({
        data: [
          createTransactionData(testAccountId, {
            merchant: 'Restaurant',
            merchantNormalized: 'restaurant',
            amount: -45.0,
            date: new Date('2024-01-15'),
          }),
          createTransactionData(testAccountId, {
            merchant: 'Gas Station',
            merchantNormalized: 'gas station',
            amount: -32.5,
            date: new Date('2024-02-20'),
          }),
        ],
      });

      const detected = await detectRecurringTransactions(prisma);
      expect(detected).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Sync / Persistence
  // ==========================================================================

  describe('syncDetectedRecurring', () => {
    it('creates new recurring records from detection results', async () => {
      const netflixTxs = Array.from({ length: 5 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
        })
      );
      await prisma.transaction.createMany({ data: netflixTxs });

      const detected = await detectRecurringTransactions(prisma, testAccountId);
      const result = await syncDetectedRecurring(prisma, detected);

      expect(result.created).toBeGreaterThanOrEqual(1);
      expect(result.updated).toBe(0);
      expect(result.skippedManual).toBe(0);

      // Verify it's in the database
      const records = await prisma.recurringTransaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(records.length).toBeGreaterThanOrEqual(1);
      const netflix = records.find((r) => r.merchantPattern === 'netflix');
      expect(netflix).toBeDefined();
      expect(netflix!.frequency).toBe('monthly');
    });

    it('updates existing records on re-detection', async () => {
      // First round: 4 months
      const txs1 = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
        })
      );
      await prisma.transaction.createMany({ data: txs1 });

      const detected1 = await detectRecurringTransactions(prisma, testAccountId);
      await syncDetectedRecurring(prisma, detected1);

      // Second round: add 2 more months
      const txs2 = Array.from({ length: 2 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, 4 + i, 15)),
        })
      );
      await prisma.transaction.createMany({ data: txs2 });

      const detected2 = await detectRecurringTransactions(prisma, testAccountId);
      const result2 = await syncDetectedRecurring(prisma, detected2);

      expect(result2.updated).toBeGreaterThanOrEqual(1);
      expect(result2.created).toBe(0);

      // Verify transaction count was updated
      const record = await prisma.recurringTransaction.findFirst({
        where: { merchantPattern: 'netflix', accountId: testAccountId },
      });
      expect(record!.transactionCount).toBe(6);
    });

    it('skips manually overridden records', async () => {
      // Create a manual override record first
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix (custom)',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 19.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 1.0,
          intervalRegularity: 1.0,
          amountConsistency: 1.0,
          transactionCount: 0,
          firstSeenDate: new Date(),
          lastSeenDate: new Date(),
          status: 'active',
          isManualOverride: true,
          manuallyCreated: true,
          priceHistory: '[]',
        },
      });

      // Now run detection with actual transactions
      const txs = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
        })
      );
      await prisma.transaction.createMany({ data: txs });

      const detected = await detectRecurringTransactions(prisma, testAccountId);
      const result = await syncDetectedRecurring(prisma, detected);

      expect(result.skippedManual).toBeGreaterThanOrEqual(1);

      // The manual record should still have the custom display name and amount
      const record = await prisma.recurringTransaction.findFirst({
        where: { merchantPattern: 'netflix', accountId: testAccountId },
      });
      expect(record!.merchantDisplay).toBe('Netflix (custom)');
      expect(record!.expectedAmount).toBe(19.99);
    });

    it('handles empty detection results', async () => {
      const result = await syncDetectedRecurring(prisma, []);
      expect(result).toEqual({ created: 0, updated: 0, skippedManual: 0 });
    });
  });

  // ==========================================================================
  // Soft Delete / Dismissed Behavior
  // ==========================================================================

  describe('dismissed subscriptions', () => {
    it('dismissed records are not recreated by detection', async () => {
      // Create dismissed record
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 4,
          firstSeenDate: new Date('2024-01-15'),
          lastSeenDate: new Date('2024-04-15'),
          status: 'dismissed',
          isManualOverride: true,
          priceHistory: '[]',
        },
      });

      // Add transactions that would normally be detected
      const txs = Array.from({ length: 5 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(2024, i, 15)),
        })
      );
      await prisma.transaction.createMany({ data: txs });

      const detected = await detectRecurringTransactions(prisma, testAccountId);
      const result = await syncDetectedRecurring(prisma, detected);

      // Should skip because isManualOverride = true
      expect(result.skippedManual).toBeGreaterThanOrEqual(1);
      expect(result.created).toBe(0);

      // The record should remain dismissed
      const record = await prisma.recurringTransaction.findFirst({
        where: { merchantPattern: 'netflix', accountId: testAccountId },
      });
      expect(record!.status).toBe('dismissed');
    });
  });

  // ==========================================================================
  // Summary
  // ==========================================================================

  describe('getRecurringSummary', () => {
    it('returns summary with active subscriptions', async () => {
      // Create active recurring record
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date('2024-01-15'),
          lastSeenDate: new Date('2024-06-15'),
          status: 'active',
          priceHistory: JSON.stringify([{ date: '2024-01-15', amount: 15.99 }]),
        },
      });

      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.activeCount).toBe(1);
      expect(summary.lapsedCount).toBe(0);
      expect(summary.totalMonthlyEstimate).toBeCloseTo(15.99, 1);
      expect(summary.totalAnnualEstimate).toBeCloseTo(15.99 * 12, 0);
      expect(summary.items).toHaveLength(1);
      expect(summary.items[0].merchantDisplay).toBe('Netflix');
    });

    it('excludes dismissed subscriptions from summary', async () => {
      // Active subscription
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date('2024-01-15'),
          lastSeenDate: new Date('2024-06-15'),
          status: 'active',
          priceHistory: '[]',
        },
      });

      // Dismissed subscription
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'hulu',
          merchantDisplay: 'Hulu',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 12.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.9,
          intervalRegularity: 0.9,
          amountConsistency: 0.95,
          transactionCount: 3,
          firstSeenDate: new Date('2024-01-01'),
          lastSeenDate: new Date('2024-03-01'),
          status: 'dismissed',
          isManualOverride: true,
          priceHistory: '[]',
        },
      });

      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.items).toHaveLength(1);
      expect(summary.items[0].merchantDisplay).toBe('Netflix');
      expect(summary.activeCount).toBe(1);
    });

    it('counts lapsed subscriptions correctly', async () => {
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'hbo',
          merchantDisplay: 'HBO Max',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 14.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.9,
          intervalRegularity: 0.9,
          amountConsistency: 0.95,
          transactionCount: 4,
          firstSeenDate: new Date('2023-01-15'),
          lastSeenDate: new Date('2023-04-15'),
          status: 'lapsed',
          priceHistory: '[]',
        },
      });

      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.lapsedCount).toBe(1);
      expect(summary.activeCount).toBe(0);
      // Lapsed items shouldn't count toward monthly estimate
      expect(summary.totalMonthlyEstimate).toBe(0);
    });

    it('computes monthly equivalents for different frequencies', async () => {
      // Annual subscription: $119.88/year → ~$9.99/month
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'amazon prime',
          merchantDisplay: 'Amazon Prime',
          accountId: testAccountId,
          frequency: 'annual',
          expectedAmount: 119.88,
          amountVariance: 0,
          medianIntervalDays: 365,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 2,
          firstSeenDate: new Date('2023-03-01'),
          lastSeenDate: new Date('2024-03-01'),
          status: 'active',
          priceHistory: '[]',
        },
      });

      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.items[0].monthlyEquivalent).toBeCloseTo(119.88 / 12, 1);
      expect(summary.totalMonthlyEstimate).toBeCloseTo(119.88 / 12, 1);
    });

    it('includes account and category relations', async () => {
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          categoryId: testCategoryId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date('2024-01-15'),
          lastSeenDate: new Date('2024-06-15'),
          status: 'active',
          priceHistory: '[]',
        },
      });

      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.items[0].account).toEqual({
        id: testAccountId,
        name: 'Test Checking',
      });
      expect(summary.items[0].category).toEqual({
        id: testCategoryId,
        name: 'Subscriptions',
      });
    });

    it('returns empty summary when no records exist', async () => {
      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.totalMonthlyEstimate).toBe(0);
      expect(summary.totalAnnualEstimate).toBe(0);
      expect(summary.activeCount).toBe(0);
      expect(summary.lapsedCount).toBe(0);
      expect(summary.items).toHaveLength(0);
    });

    it('parses price history JSON correctly', async () => {
      const priceHistory = [
        { date: '2024-01-15', amount: 12.99 },
        { date: '2024-04-15', amount: 15.49 },
      ];

      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.49,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.9,
          transactionCount: 6,
          firstSeenDate: new Date('2024-01-15'),
          lastSeenDate: new Date('2024-06-15'),
          status: 'active',
          priceHistory: JSON.stringify(priceHistory),
        },
      });

      const summary = await getRecurringSummary(prisma, testAccountId);

      expect(summary.items[0].priceHistory).toEqual(priceHistory);
    });
  });

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  describe('recurring transaction CRUD', () => {
    it('creates a manual subscription entry', async () => {
      const record = await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'gym membership',
          merchantDisplay: 'Planet Fitness',
          accountId: testAccountId,
          categoryId: testCategoryId,
          frequency: 'monthly',
          expectedAmount: 24.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 1.0,
          intervalRegularity: 1.0,
          amountConsistency: 1.0,
          transactionCount: 0,
          firstSeenDate: new Date(),
          lastSeenDate: new Date(),
          status: 'active',
          isManualOverride: true,
          manuallyCreated: true,
          priceHistory: JSON.stringify([
            { date: new Date().toISOString().split('T')[0], amount: 24.99 },
          ]),
        },
      });

      expect(record.merchantDisplay).toBe('Planet Fitness');
      expect(record.isManualOverride).toBe(true);
      expect(record.manuallyCreated).toBe(true);
    });

    it('updates a recurring entry and sets manual override', async () => {
      const record = await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date('2024-01-15'),
          lastSeenDate: new Date('2024-06-15'),
          status: 'active',
          priceHistory: '[]',
        },
      });

      const updated = await prisma.recurringTransaction.update({
        where: { id: record.id },
        data: {
          expectedAmount: 22.99,
          isManualOverride: true,
        },
      });

      expect(updated.expectedAmount).toBe(22.99);
      expect(updated.isManualOverride).toBe(true);
    });

    it('soft-deletes by setting status to dismissed', async () => {
      const record = await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'hulu',
          merchantDisplay: 'Hulu',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 12.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.9,
          intervalRegularity: 0.9,
          amountConsistency: 0.95,
          transactionCount: 3,
          firstSeenDate: new Date('2024-01-01'),
          lastSeenDate: new Date('2024-03-01'),
          status: 'active',
          priceHistory: '[]',
        },
      });

      // Soft-delete
      await prisma.recurringTransaction.update({
        where: { id: record.id },
        data: {
          status: 'dismissed',
          isManualOverride: true,
        },
      });

      // Record still exists
      const dismissed = await prisma.recurringTransaction.findUnique({
        where: { id: record.id },
      });
      expect(dismissed).not.toBeNull();
      expect(dismissed!.status).toBe('dismissed');
      expect(dismissed!.isManualOverride).toBe(true);

      // But excluded from summary
      const summary = await getRecurringSummary(prisma, testAccountId);
      expect(summary.items).toHaveLength(0);
    });

    it('enforces unique constraint on accountId + merchantPattern', async () => {
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date(),
          lastSeenDate: new Date(),
          status: 'active',
          priceHistory: '[]',
        },
      });

      // Attempting to create duplicate should fail
      await expect(
        prisma.recurringTransaction.create({
          data: {
            merchantPattern: 'netflix',
            merchantDisplay: 'Netflix Duplicate',
            accountId: testAccountId,
            frequency: 'monthly',
            expectedAmount: 15.99,
            amountVariance: 0,
            medianIntervalDays: 30,
            confidence: 0.95,
            intervalRegularity: 0.95,
            amountConsistency: 0.99,
            transactionCount: 6,
            firstSeenDate: new Date(),
            lastSeenDate: new Date(),
            status: 'active',
            priceHistory: '[]',
          },
        })
      ).rejects.toThrow();
    });

    it('allows same merchantPattern on different accounts', async () => {
      const account2 = createAccountData({ id: 'test-account-2', name: 'Credit Card' });
      await prisma.account.create({ data: account2 });

      // Netflix on account 1
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date(),
          lastSeenDate: new Date(),
          status: 'active',
          priceHistory: '[]',
        },
      });

      // Netflix on account 2 — should succeed
      const record2 = await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: account2.id!,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date(),
          lastSeenDate: new Date(),
          status: 'active',
          priceHistory: '[]',
        },
      });

      expect(record2).toBeDefined();
      expect(record2.accountId).toBe(account2.id);
    });

    it('cascades deletion when account is deleted', async () => {
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: 'netflix',
          merchantDisplay: 'Netflix',
          accountId: testAccountId,
          frequency: 'monthly',
          expectedAmount: 15.99,
          amountVariance: 0,
          medianIntervalDays: 30,
          confidence: 0.95,
          intervalRegularity: 0.95,
          amountConsistency: 0.99,
          transactionCount: 6,
          firstSeenDate: new Date(),
          lastSeenDate: new Date(),
          status: 'active',
          priceHistory: '[]',
        },
      });

      // Delete account (should cascade)
      await prisma.account.delete({ where: { id: testAccountId } });

      const records = await prisma.recurringTransaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(records).toHaveLength(0);
    });
  });

  // ==========================================================================
  // End-to-End Detection Pipeline
  // ==========================================================================

  describe('full detection pipeline', () => {
    it('detect → sync → summary round-trip', async () => {
      // Insert subscription transactions using recent months so they detect as "active"
      const now = new Date();
      const netflixTxs = Array.from({ length: 6 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
          amount: -15.99,
          date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 15)),
          categoryId: testCategoryId,
        })
      );
      await prisma.transaction.createMany({ data: netflixTxs });

      // Step 1: Detect
      const detected = await detectRecurringTransactions(prisma, testAccountId);
      expect(detected.length).toBeGreaterThanOrEqual(1);

      // Step 2: Sync to DB
      const syncResult = await syncDetectedRecurring(prisma, detected);
      expect(syncResult.created).toBeGreaterThanOrEqual(1);

      // Step 3: Summary
      const summary = await getRecurringSummary(prisma, testAccountId);
      expect(summary.activeCount).toBeGreaterThanOrEqual(1);
      expect(summary.items.length).toBeGreaterThanOrEqual(1);

      const netflixItem = summary.items.find((i) => i.merchantPattern === 'netflix');
      expect(netflixItem).toBeDefined();
      expect(netflixItem!.frequency).toBe('monthly');
      expect(netflixItem!.account?.name).toBe('Test Checking');
      expect(netflixItem!.category?.name).toBe('Subscriptions');
    });

    it('re-detection updates counts without creating duplicates', async () => {
      // Round 1: 4 months
      const round1 = Array.from({ length: 4 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Spotify',
          merchantNormalized: 'spotify',
          amount: -9.99,
          date: new Date(Date.UTC(2024, i, 1)),
        })
      );
      await prisma.transaction.createMany({ data: round1 });

      const d1 = await detectRecurringTransactions(prisma, testAccountId);
      await syncDetectedRecurring(prisma, d1);

      const count1 = await prisma.recurringTransaction.count({
        where: { merchantPattern: 'spotify', accountId: testAccountId },
      });
      expect(count1).toBe(1);

      // Round 2: add 2 more months
      const round2 = Array.from({ length: 2 }, (_, i) =>
        createTransactionData(testAccountId, {
          merchant: 'Spotify',
          merchantNormalized: 'spotify',
          amount: -9.99,
          date: new Date(Date.UTC(2024, 4 + i, 1)),
        })
      );
      await prisma.transaction.createMany({ data: round2 });

      const d2 = await detectRecurringTransactions(prisma, testAccountId);
      await syncDetectedRecurring(prisma, d2);

      // Still only one record
      const count2 = await prisma.recurringTransaction.count({
        where: { merchantPattern: 'spotify', accountId: testAccountId },
      });
      expect(count2).toBe(1);

      // But transaction count should be updated
      const record = await prisma.recurringTransaction.findFirst({
        where: { merchantPattern: 'spotify', accountId: testAccountId },
      });
      expect(record!.transactionCount).toBe(6);
    });
  });
});
