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
import { syncTellerTransactions, type SyncResult } from '@/lib/teller-sync';
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
          matchType: 'merchantContains',
          matchValue: 'trader joe',
          categoryId: groceryCategoryId,
          priority: 10,
          isEnabled: true,
        },
        {
          matchType: 'merchantContains',
          matchValue: 'uber',
          categoryId: transportCategoryId,
          priority: 10,
          isEnabled: true,
        },
      ],
    });
  });

  function createMockTellerConnection(accountId: string) {
    return {
      id: 'teller-conn-1',
      accountId,
      tellerEnrollmentId: 'teller-enrollment-123',
      tellerAccountId: 'teller-account-123',
      lastSyncDate: null,
      account: { id: accountId, name: 'Test Account' },
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
      const result = await syncTellerTransactions(connection);

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
      const result = await syncTellerTransactions(connection);

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
      const result = await syncTellerTransactions(connection);

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
      const result = await syncTellerTransactions(connection);

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
      const result = await syncTellerTransactions(connection);

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
      const result = await syncTellerTransactions(connection, { includePending: true });

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
      const result = await syncTellerTransactions(connection);

      expect(result.added).toBe(251);
      expect(vi.mocked(tellerFetch)).toHaveBeenCalledTimes(2);
    });

    it('preserves Teller amount sign (negative = expense)', async () => {
      vi.mocked(tellerFetch).mockResolvedValueOnce([
        createMockTellerTransaction({
          id: 'expense-tx',
          description: 'Store',
          amount: '-50.00', // Teller: negative = expense
        }),
        createMockTellerTransaction({
          id: 'income-tx',
          description: 'Payroll',
          amount: '5000.00', // Teller: positive = income
        }),
      ]);

      await createTellerDbRecords(testAccountId);

      const connection = createMockTellerConnection(testAccountId);
      await syncTellerTransactions(connection);

      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
        orderBy: { amount: 'asc' },
      });

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
});
