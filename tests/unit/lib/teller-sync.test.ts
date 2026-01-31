import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

// Store the test prisma instance to inject into mocks
let testPrisma: PrismaClient;

// Mock the dependencies before importing the module
vi.mock('@/lib/teller', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/teller')>();
  return {
    ...original,
    tellerFetch: vi.fn(),
  };
});

vi.mock('@/lib/encryption', () => ({
  decryptAccessToken: vi.fn(() => 'decrypted-access-token'),
}));

// Mock prisma to use test database
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

// Import after mocking
import { syncTellerTransactions, type SyncResult, type DryRunResult } from '@/lib/teller-sync';
import { tellerFetch } from '@/lib/teller';

describe('teller-sync', () => {
  let prisma: PrismaClient;
  let testAccountId: string;
  let groceryCategoryId: string;
  let transportCategoryId: string;
  let shoppingCategoryId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    testPrisma = prisma;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();

    // Create test account
    const account = await prisma.account.create({
      data: createAccountData({ name: 'Teller Test Account' }),
    });
    testAccountId = account.id;

    // Create categories for auto-categorization
    const groceryCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Groceries', type: 'expense' }),
    });
    const transportCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Transport', type: 'expense' }),
    });
    const shoppingCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Shopping', type: 'expense' }),
    });

    groceryCategoryId = groceryCategory.id;
    transportCategoryId = transportCategory.id;
    shoppingCategoryId = shoppingCategory.id;

    // Create categorization rules
    await prisma.rule.createMany({
      data: [
        {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'trader joe' },
          ]),
          categoryId: groceryCategoryId,
          priority: 10,
          isEnabled: true,
        },
        {
          conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'uber' }]),
          categoryId: transportCategoryId,
          priority: 10,
          isEnabled: true,
        },
      ],
    });
  });

  function createMockTellerConnection(accountId: string, invertAmounts: boolean = false) {
    return {
      id: 'teller-conn-1',
      accountId,
      tellerEnrollmentId: 'teller-enrollment-123',
      tellerAccountId: 'teller-account-123',
      lastSyncDate: null,
      account: { id: accountId, name: 'Test Account', invertAmounts },
      tellerEnrollment: {
        id: 'teller-enrollment-123',
        accessTokenEncrypted: 'encrypted-token',
        accessTokenIv: 'iv-value',
      },
    };
  }

  function createMockTellerTransaction(overrides: Record<string, unknown> = {}) {
    return {
      id: `teller-tx-${Math.random().toString(36).substring(7)}`,
      account_id: 'teller-account-123',
      date: new Date().toISOString().split('T')[0],
      description: 'Test Transaction',
      amount: '-25.00',
      status: 'posted',
      type: 'card_payment',
      details: {
        category: 'shopping',
        counterparty: {
          name: 'Test Merchant',
          type: 'merchant',
        },
        processing_status: 'complete',
      },
      ...overrides,
    };
  }

  async function createTellerDbRecords(accountId: string) {
    await prisma.tellerEnrollment.create({
      data: {
        id: 'teller-enrollment-123',
        enrollmentId: 'teller-enrollment-id-123',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'encrypted-token',
        accessTokenIv: 'iv-value',
        status: 'active',
      },
    });

    await prisma.tellerConnection.create({
      data: {
        id: 'teller-conn-1',
        accountId,
        tellerEnrollmentId: 'teller-enrollment-123',
        tellerAccountId: 'teller-account-123',
        status: 'active',
      },
    });
  }

  describe('syncTellerTransactions', () => {
    it('adds new transactions from Teller', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'new-tx-1',
          description: 'Coffee Shop',
          amount: '-5.50',
          details: {
            category: 'food_and_drink',
            counterparty: { name: 'Coffee Shop', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
        createMockTellerTransaction({
          id: 'new-tx-2',
          description: 'Gas Station',
          amount: '-45.00',
          details: {
            category: 'transportation',
            counterparty: { name: 'Gas Station', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      // Create teller connection in database
      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.added).toBe(2);
      expect(result.modified).toBe(0);
      expect(result.removed).toBe(0);

      // Verify transactions were created
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(2);
    });

    it('maps Teller categories to FinanceOS categories', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'shopping-tx',
          description: 'Amazon Purchase',
          amount: '-67.89',
          details: {
            category: 'shopping',
            counterparty: { name: 'Amazon', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.autoCategorized).toBe(1);

      // Verify category was applied from Teller mapping
      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.categoryId).toBe(shoppingCategoryId);
      expect(tx?.confidenceScore).toBe(0.85); // Teller category confidence
    });

    it('falls back to auto-categorization when Teller category not mapped', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'uber-tx',
          description: 'UBER *TRIP',
          amount: '-24.50',
          details: {
            category: 'unknown_category',
            counterparty: { name: 'Uber', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.autoCategorized).toBe(1);

      // Should fall back to rule-based categorization
      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.categoryId).toBe(transportCategoryId);
      expect(tx?.confidenceScore).toBe(0.98); // Rule-based confidence
    });

    it('skips duplicate transactions by externalId', async () => {
      // First, create an existing transaction
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'existing-tx-1',
          date: new Date(),
          amount: -25,
          merchant: 'Test Merchant',
          merchantNormalized: 'test merchant',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'existing-tx-1', // Same as existing
          description: 'Test Merchant',
          amount: '-25.00',
        }),
        createMockTellerTransaction({
          id: 'new-tx-1',
          description: 'New Merchant',
          amount: '-15.00',
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.skippedDuplicates).toBe(1);

      // Verify only 2 transactions total (1 existing + 1 new)
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(2);
    });

    it('skips pending transactions by default', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'pending-tx',
          description: 'Pending Transaction',
          amount: '-25.00',
          status: 'pending',
        }),
        createMockTellerTransaction({
          id: 'posted-tx',
          description: 'Posted Transaction',
          amount: '-15.00',
          status: 'posted',
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.skippedPending).toBe(1);
    });

    it('includes pending transactions when includePending is true', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'pending-tx',
          description: 'Pending Transaction',
          amount: '-25.00',
          status: 'pending',
        }),
        createMockTellerTransaction({
          id: 'posted-tx',
          description: 'Posted Transaction',
          amount: '-15.00',
          status: 'posted',
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, {
        includePending: true,
      })) as SyncResult;

      expect(result.added).toBe(2);
      expect(result.skippedPending).toBe(0);
    });

    it('handles pagination when more than 250 transactions', async () => {
      vi.mocked(tellerFetch)
        .mockResolvedValueOnce(
          // First page: 250 transactions
          Array.from({ length: 250 }, (_, i) =>
            createMockTellerTransaction({
              id: `page1-tx-${i}`,
              description: `Store ${i}`,
              amount: '-10.00',
            })
          )
        )
        .mockResolvedValueOnce([
          // Second page: less than 250, indicates end
          createMockTellerTransaction({
            id: 'page2-tx-1',
            description: 'Last Store',
            amount: '-10.00',
          }),
        ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.added).toBe(251);
      expect(vi.mocked(tellerFetch)).toHaveBeenCalledTimes(2);
    });

    it('applies default amount conversion (positive bank amount = negative expense)', async () => {
      // Teller API docs say positive = expense, negative = income
      // Our code inverts: positive bank amount becomes negative expense in FinanceOS
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'expense-tx',
          description: 'Store',
          amount: '50.00', // Teller: positive = expense
        }),
        createMockTellerTransaction({
          id: 'income-tx',
          description: 'Payroll',
          amount: '-5000.00', // Teller: negative = income
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection);

      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
        orderBy: { amount: 'asc' },
      });

      expect(transactions[0].amount).toBe(-50); // Expense (inverted from +50)
      expect(transactions[1].amount).toBe(5000); // Income (inverted from -5000)
    });

    it('respects invertAmounts flag for accounts with different conventions', async () => {
      // Some accounts may report amounts backwards from the standard convention
      // Use invertAmounts to flip the sign during sync
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'expense-tx',
          description: 'Store',
          amount: '-50.00', // This bank: negative = expense (non-standard)
        }),
        createMockTellerTransaction({
          id: 'income-tx',
          description: 'Payroll',
          amount: '5000.00', // This bank: positive = income (non-standard)
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      // Enable invertAmounts for this account
      const connection = createMockTellerConnection(testAccountId, true);
      await syncTellerTransactions(connection);

      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
        orderBy: { amount: 'asc' },
      });

      // With invertAmounts=true, -50 becomes -50 (double inversion: -(-50) = 50, then inverted again = -50)
      // Actually: convertBankAmount(-50, true) = -(-(-50)) = -50
      expect(transactions[0].amount).toBe(-50); // Expense
      expect(transactions[1].amount).toBe(5000); // Income
    });

    it('uses counterparty name as merchant when available', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'counterparty-tx',
          description: 'CARD PURCHASE *12345',
          amount: '-25.00',
          details: {
            category: 'shopping',
            counterparty: {
              name: 'Clean Merchant Name',
              type: 'merchant',
            },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection);

      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.merchant).toBe('Clean Merchant Name');
    });

    it('updates connection sync status on success', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection);

      const updatedConnection = await prisma.tellerConnection.findUnique({
        where: { id: 'teller-conn-1' },
      });
      expect(updatedConnection?.lastSyncStatus).toBe('success');
      expect(updatedConnection?.lastSyncAt).toBeDefined();
      expect(updatedConnection?.lastSyncDate).toBeDefined();
    });

    it('respects daysToSync option', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection, { daysToSync: 60 });

      // Verify the date range in the API call
      expect(vi.mocked(tellerFetch)).toHaveBeenCalledWith(
        expect.stringContaining('/transactions'),
        'decrypted-access-token',
        expect.objectContaining({
          params: expect.objectContaining({
            from_date: expect.any(String),
            to_date: expect.any(String),
          }),
        })
      );
    });
  });

  describe('dry-run mode', () => {
    it('returns transaction previews without creating records', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'preview-tx-1',
          description: 'Coffee Shop',
          amount: '-5.50',
          details: {
            category: 'food_and_drink',
            counterparty: { name: 'Coffee Shop', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
        createMockTellerTransaction({
          id: 'preview-tx-2',
          description: 'Gas Station',
          amount: '-45.00',
          details: {
            category: 'transportation',
            counterparty: { name: 'Gas Station', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, { dryRun: true })) as DryRunResult;

      // Should return dry-run result structure
      expect(result.stats).toBeDefined();
      expect(result.transactions).toBeDefined();
      expect(result.dateRange).toBeDefined();
      expect(result.totalFetched).toBe(2);

      // Stats should show what would happen
      expect(result.stats.added).toBe(2);
      expect(result.stats.skippedDuplicates).toBe(0);

      // Transactions array should have previews
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].externalId).toBe('preview-tx-1');
      expect(result.transactions[0].wouldCreate).toBe(true);
      expect(result.transactions[0].skipReason).toBeNull();

      // NO actual transactions should be created
      const dbTransactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(dbTransactions).toHaveLength(0);
    });

    it('marks duplicates correctly in dry-run mode', async () => {
      // Create an existing transaction
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'existing-tx-1',
          date: new Date(),
          amount: -25,
          merchant: 'Test Merchant',
          merchantNormalized: 'test merchant',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'existing-tx-1', // Duplicate
          description: 'Test Merchant',
          amount: '-25.00',
        }),
        createMockTellerTransaction({
          id: 'new-tx-1',
          description: 'New Merchant',
          amount: '-15.00',
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, { dryRun: true })) as DryRunResult;

      expect(result.stats.added).toBe(1);
      expect(result.stats.skippedDuplicates).toBe(1);

      // Find the duplicate preview
      const duplicate = result.transactions.find((t) => t.externalId === 'existing-tx-1');
      expect(duplicate?.wouldCreate).toBe(false);
      expect(duplicate?.skipReason).toContain('duplicate');

      // Find the new preview
      const newTx = result.transactions.find((t) => t.externalId === 'new-tx-1');
      expect(newTx?.wouldCreate).toBe(true);

      // Should still only have 1 transaction in DB (the pre-existing one)
      const dbTransactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(dbTransactions).toHaveLength(1);
    });

    it('shows pending transactions as skipped in dry-run mode', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'pending-tx',
          description: 'Pending Transaction',
          amount: '-25.00',
          status: 'pending',
        }),
        createMockTellerTransaction({
          id: 'posted-tx',
          description: 'Posted Transaction',
          amount: '-15.00',
          status: 'posted',
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, { dryRun: true })) as DryRunResult;

      expect(result.stats.added).toBe(1);
      expect(result.stats.skippedPending).toBe(1);

      // Pending should show as would not create
      const pending = result.transactions.find((t) => t.externalId === 'pending-tx');
      expect(pending?.wouldCreate).toBe(false);
      expect(pending?.skipReason).toContain('Pending');

      // Posted should show as would create
      const posted = result.transactions.find((t) => t.externalId === 'posted-tx');
      expect(posted?.wouldCreate).toBe(true);
    });

    it('includes category prediction in previews', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'shopping-tx',
          description: 'Amazon Purchase',
          amount: '-67.89',
          details: {
            category: 'shopping',
            counterparty: { name: 'Amazon', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, { dryRun: true })) as DryRunResult;

      expect(result.transactions).toHaveLength(1);
      const preview = result.transactions[0];

      expect(preview.category).toBe('Shopping');
      expect(preview.categoryConfidence).toBe(0.85);
      expect(preview.tellerCategory).toBe('shopping');
    });

    it('does not update connection sync status in dry-run mode', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'tx-1',
          description: 'Test',
          amount: '-10.00',
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      // Get initial connection state
      const initialConnection = await prisma.tellerConnection.findUnique({
        where: { id: 'teller-conn-1' },
      });
      const initialSyncAt = initialConnection?.lastSyncAt;

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection, { dryRun: true });

      // Verify connection was NOT updated
      const updatedConnection = await prisma.tellerConnection.findUnique({
        where: { id: 'teller-conn-1' },
      });
      expect(updatedConnection?.lastSyncAt).toEqual(initialSyncAt);
    });

    it('includes date range in dry-run result', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, {
        dryRun: true,
        daysToSync: 7,
      })) as DryRunResult;

      expect(result.dateRange).toBeDefined();
      expect(result.dateRange.from).toBeDefined();
      expect(result.dateRange.to).toBeDefined();

      // Verify dates are valid ISO strings
      expect(new Date(result.dateRange.from).toString()).not.toBe('Invalid Date');
      expect(new Date(result.dateRange.to).toString()).not.toBe('Invalid Date');
    });
  });

  describe('transaction merge', () => {
    it('merges Teller transaction with existing CSV import by date+amount+merchant', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 5); // 5 days ago
      const dateStr = testDate.toISOString().split('T')[0];

      // Create existing manual import (no externalId)
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(dateStr),
          amount: -25.5,
          merchant: '"Coffee Shop"', // CSV import with quotes
          merchantNormalized: 'coffee shop',
          importHash: 'abc123',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'teller-tx-merge',
          date: dateStr,
          description: 'COFFEE SHOP PURCHASE',
          amount: '-25.50',
          details: {
            category: 'food_and_drink',
            counterparty: { name: 'Coffee Shop', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.merged).toBe(1);
      expect(result.added).toBe(0);

      // Verify transaction was merged, not duplicated
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(1);

      // Verify externalId was added
      expect(transactions[0].externalId).toBe('teller-tx-merge');
    });

    it('updates merchant name during merge if Teller version is cleaner', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 5);
      const dateStr = testDate.toISOString().split('T')[0];

      // Create existing with quoted merchant
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(dateStr),
          amount: -25.5,
          merchant: '"STARBUCKS COFFEE"', // Quoted and all caps
          merchantNormalized: 'starbucks coffee',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'teller-tx-clean',
          date: dateStr,
          amount: '-25.50',
          details: {
            category: 'food_and_drink',
            counterparty: { name: 'Starbucks Coffee', type: 'merchant' }, // Clean name
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection);

      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.merchant).toBe('Starbucks Coffee');
    });

    it('does not merge when externalId already exists', async () => {
      const testDate = new Date();
      const dateStr = testDate.toISOString().split('T')[0];

      // Create existing WITH externalId (already synced)
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'existing-external-id',
          date: new Date(dateStr),
          amount: -25.5,
          merchant: 'Coffee Shop',
          merchantNormalized: 'coffee shop',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'existing-external-id', // Same externalId
          date: dateStr,
          amount: '-25.50',
          details: {
            counterparty: { name: 'Coffee Shop', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      expect(result.skippedDuplicates).toBe(1);
      expect(result.merged).toBe(0);
    });

    it('does not merge when merchants are completely different (safety)', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 3);
      const dateStr = testDate.toISOString().split('T')[0];

      // Create existing with completely different merchant name
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(dateStr),
          amount: -42.99,
          merchant: 'AMAZON MKTPLACE PMTS',
          merchantNormalized: 'amazon mktplace pmts',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'different-merchant-tx',
          date: dateStr,
          amount: '-42.99',
          details: {
            category: 'shopping',
            counterparty: { name: 'Target Store', type: 'merchant' }, // Completely different
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      // Should NOT merge - merchants are completely different, even if same date+amount
      // This is safer: user can manually delete the duplicate
      expect(result.merged).toBe(0);
      expect(result.added).toBe(1);

      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(2);
    });

    it('dry-run shows merge candidates correctly', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 5);
      const dateStr = testDate.toISOString().split('T')[0];

      const existingTx = await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(dateStr),
          amount: -25.5,
          merchant: 'Coffee Shop',
          merchantNormalized: 'coffee shop',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'teller-merge-preview',
          date: dateStr,
          amount: '-25.50',
          details: {
            counterparty: { name: 'Coffee Shop', type: 'merchant' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection, { dryRun: true })) as DryRunResult;

      expect(result.stats.merged).toBe(1);
      expect(result.transactions).toHaveLength(1);

      const preview = result.transactions[0];
      expect(preview.wouldMerge).toBe(true);
      expect(preview.wouldCreate).toBe(false);
      expect(preview.existingTransactionId).toBe(existingTx.id);
      expect(preview.skipReason).toContain('merge');

      // Verify no changes were made in dry-run
      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.externalId).toBeNull();
    });

    it('merges transactions when dates differ by up to 3 days', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 10);
      const csvDateStr = testDate.toISOString().split('T')[0];

      // Teller date is 2 days after CSV import date
      const tellerDate = new Date(testDate);
      tellerDate.setDate(tellerDate.getDate() + 2);
      const tellerDateStr = tellerDate.toISOString().split('T')[0];

      // Create existing manual import with earlier date
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(csvDateStr),
          amount: -150.0,
          merchant: 'Zelle payment from AMELIA XU',
          merchantNormalized: 'zelle payment from amelia xu',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'teller-zelle-tx',
          date: tellerDateStr, // 2 days different
          amount: '-150.00',
          details: {
            category: 'transfer',
            counterparty: { name: 'Zelle payment from AMELIA XU', type: 'person' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      // Should merge despite date difference
      expect(result.merged).toBe(1);
      expect(result.added).toBe(0);

      // Verify only one transaction exists with externalId
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0].externalId).toBe('teller-zelle-tx');
    });

    it('does not merge when dates differ by more than 3 days', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 10);
      const csvDateStr = testDate.toISOString().split('T')[0];

      // Teller date is 5 days after CSV import date (outside tolerance)
      const tellerDate = new Date(testDate);
      tellerDate.setDate(tellerDate.getDate() + 5);
      const tellerDateStr = tellerDate.toISOString().split('T')[0];

      // Create existing manual import
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(csvDateStr),
          amount: -150.0,
          merchant: 'Zelle payment from AMELIA XU',
          merchantNormalized: 'zelle payment from amelia xu',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'teller-zelle-far',
          date: tellerDateStr, // 5 days different - outside tolerance
          amount: '-150.00',
          details: {
            category: 'transfer',
            counterparty: { name: 'Zelle payment from AMELIA XU', type: 'person' },
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      // Should NOT merge (date difference too large) and create new
      expect(result.merged).toBe(0);
      expect(result.added).toBe(1);

      // Verify two transactions exist
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(2);
    });

    it('does not merge when multiple candidates exist with different merchants', async () => {
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 5);
      const dateStr = testDate.toISOString().split('T')[0];

      // Create two transactions on same date with same amount but TRULY different merchants
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(dateStr),
          amount: -25.5,
          merchant: 'Walmart Supercenter',
          merchantNormalized: 'walmart supercenter',
        },
      });

      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: null,
          date: new Date(dateStr),
          amount: -25.5,
          merchant: 'Target Store',
          merchantNormalized: 'target store',
        },
      });

      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'ambiguous-tx',
          date: dateStr,
          amount: '-25.50',
          details: {
            counterparty: { name: 'Costco Wholesale', type: 'merchant' }, // Different from both
            processing_status: 'complete',
          },
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      const result = (await syncTellerTransactions(connection)) as SyncResult;

      // Should NOT merge (ambiguous - multiple candidates, none match) and create new
      expect(result.merged).toBe(0);
      expect(result.added).toBe(1);

      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(3);
    });
  });
});
