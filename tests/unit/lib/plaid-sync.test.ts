import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

// Store the test prisma instance to inject into mocks
let testPrisma: PrismaClient;

// Mock the dependencies before importing the module
vi.mock('@/lib/plaid', () => ({
  getPlaidClient: vi.fn(),
}));

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
import { syncPlaidTransactions, type SyncResult, type DryRunResult } from '@/lib/plaid-sync';
import { getPlaidClient } from '@/lib/plaid';

describe('plaid-sync', () => {
  let prisma: PrismaClient;
  let testAccountId: string;
  let groceryCategoryId: string;
  let transportCategoryId: string;

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
      data: createAccountData({ name: 'Plaid Test Account' }),
    });
    testAccountId = account.id;

    // Create categories for auto-categorization
    const groceryCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Groceries', type: 'expense' }),
    });
    const transportCategory = await prisma.category.create({
      data: createCategoryData({ name: 'Transport', type: 'expense' }),
    });

    groceryCategoryId = groceryCategory.id;
    transportCategoryId = transportCategory.id;

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

    // Create plaid enrollment (institution-level)
    await prisma.plaidEnrollment.create({
      data: {
        id: 'plaid-enroll-1',
        plaidItemId: 'plaid-item-123',
        institutionName: 'Test Bank',
        accessTokenEncrypted: 'encrypted-token',
        accessTokenIv: 'iv-value',
        status: 'connected',
      },
    });

    // Create plaid connection (account-level)
    await prisma.plaidConnection.create({
      data: {
        id: 'plaid-conn-1',
        accountId: testAccountId,
        plaidEnrollmentId: 'plaid-enroll-1',
        plaidAccountId: 'plaid-account-123',
        status: 'connected',
      },
    });
  });

  function createMockPlaidConnection(accountId: string, invertAmounts: boolean = false) {
    return {
      id: 'plaid-conn-1',
      accountId,
      plaidAccountId: 'plaid-account-123',
      account: { id: accountId, name: 'Test Account', invertAmounts },
      plaidEnrollment: {
        id: 'plaid-enroll-1',
        plaidItemId: 'plaid-item-123',
        accessTokenEncrypted: 'encrypted-token',
        accessTokenIv: 'iv-value',
        transactionCursor: null,
      },
    };
  }

  function createMockPlaidTransaction(overrides: Record<string, unknown> = {}) {
    return {
      transaction_id: `plaid-tx-${Math.random().toString(36).substring(7)}`,
      account_id: 'plaid-account-123',
      date: new Date().toISOString().split('T')[0],
      name: 'Test Transaction',
      merchant_name: 'Test Merchant',
      amount: 25.0,
      pending: false,
      personal_finance_category: {
        primary: 'SHOPPING',
        detailed: 'General Merchandise',
      },
      ...overrides,
    };
  }

  describe('syncPlaidTransactions', () => {
    it('adds new transactions from Plaid', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'new-tx-1',
                merchant_name: 'Coffee Shop',
                amount: 5.5,
              }),
              createMockPlaidTransaction({
                transaction_id: 'new-tx-2',
                merchant_name: 'Gas Station',
                amount: 45.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.added).toBe(2);
      expect(result.modified).toBe(0);
      expect(result.removed).toBe(0);

      // Verify transactions were created
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(2);
    });

    it('auto-categorizes transactions using rules', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'grocery-tx',
                merchant_name: "Trader Joe's",
                amount: 89.42,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.autoCategorized).toBe(1);

      // Verify category was applied
      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.categoryId).toBe(groceryCategoryId);
      expect(tx?.confidenceScore).toBe(0.98);
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

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'existing-tx-1', // Same as existing
                merchant_name: 'Test Merchant',
                amount: 25.0,
              }),
              createMockPlaidTransaction({
                transaction_id: 'new-tx-1',
                merchant_name: 'New Merchant',
                amount: 15.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.skippedDuplicates).toBe(1);

      // Verify only 2 transactions total (1 existing + 1 new)
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(2);
    });

    it('skips transactions older than daysToSync cutoff', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45); // 45 days ago

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'old-tx-1',
                date: oldDate.toISOString().split('T')[0],
                merchant_name: 'Old Store',
                amount: 25.0,
              }),
              createMockPlaidTransaction({
                transaction_id: 'new-tx-1',
                date: new Date().toISOString().split('T')[0],
                merchant_name: 'New Store',
                amount: 15.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, { daysToSync: 30 })) as SyncResult;

      expect(result.added).toBe(1);
      expect(result.skippedOld).toBe(1);
    });

    it('handles modified transactions', async () => {
      // Create existing transaction
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'modify-tx-1',
          date: new Date(),
          amount: -25,
          merchant: 'Old Merchant Name',
          merchantNormalized: 'old merchant name',
        },
      });

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [
              createMockPlaidTransaction({
                transaction_id: 'modify-tx-1',
                merchant_name: 'Updated Merchant Name',
                amount: 30.0, // Updated amount
              }),
            ],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.modified).toBe(1);

      // Verify transaction was updated
      const tx = await prisma.transaction.findFirst({
        where: { externalId: 'modify-tx-1' },
      });
      expect(tx?.merchant).toBe('Updated Merchant Name');
      expect(tx?.amount).toBe(-30); // Inverted from Plaid's positive
    });

    it('handles removed transactions', async () => {
      // Create existing transaction
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'remove-tx-1',
          date: new Date(),
          amount: -25,
          merchant: 'To Be Removed',
          merchantNormalized: 'to be removed',
        },
      });

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [],
            removed: [{ transaction_id: 'remove-tx-1' }],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.removed).toBe(1);

      // Verify transaction was deleted
      const tx = await prisma.transaction.findFirst({
        where: { externalId: 'remove-tx-1' },
      });
      expect(tx).toBeNull();
    });

    it('handles pagination with has_more', async () => {
      const mockPlaidClient = {
        transactionsSync: vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              added: [
                createMockPlaidTransaction({
                  transaction_id: 'page1-tx-1',
                  merchant_name: 'Coffee Shop',
                  amount: 5.5,
                }),
              ],
              modified: [],
              removed: [],
              next_cursor: 'cursor-page2',
              has_more: true,
            },
          })
          .mockResolvedValueOnce({
            data: {
              added: [
                createMockPlaidTransaction({
                  transaction_id: 'page2-tx-1',
                  merchant_name: 'Gas Station',
                  amount: 42.0,
                }),
              ],
              modified: [],
              removed: [],
              next_cursor: 'cursor-final',
              has_more: false,
            },
          }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.added).toBe(2);
      expect(mockPlaidClient.transactionsSync).toHaveBeenCalledTimes(2);
    });

    it('ignores transactions for different account_id', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'tx-1',
                account_id: 'plaid-account-123', // Matches connection
                merchant_name: 'Matching Account',
              }),
              createMockPlaidTransaction({
                transaction_id: 'tx-2',
                account_id: 'different-account', // Different account
                merchant_name: 'Different Account',
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection)) as SyncResult;

      expect(result.added).toBe(1);
    });

    it('inverts Plaid amounts (positive → negative)', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'expense-tx',
                merchant_name: 'Store',
                amount: 50.0, // Plaid: positive = expense
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      await syncPlaidTransactions(connection);

      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.amount).toBe(-50); // Should be negative in FinanceOS
    });

    it('detects transfer transactions', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'transfer-tx',
                merchant_name: 'Transfer',
                amount: 500.0,
                personal_finance_category: {
                  primary: 'TRANSFER_OUT',
                  detailed: 'Transfer Out',
                },
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      await syncPlaidTransactions(connection);

      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.isTransfer).toBe(true);
    });

    it('updates enrollment cursor and connection sync status on success', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [],
            removed: [],
            next_cursor: 'new-cursor-456',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      await syncPlaidTransactions(connection);

      // Verify enrollment cursor was updated
      const updatedEnrollment = await prisma.plaidEnrollment.findUnique({
        where: { id: 'plaid-enroll-1' },
      });
      expect(updatedEnrollment?.transactionCursor).toBe('new-cursor-456');

      // Verify connection sync status was updated
      const updatedConnection = await prisma.plaidConnection.findUnique({
        where: { id: 'plaid-conn-1' },
      });
      expect(updatedConnection?.lastSyncStatus).toBe('success');
      expect(updatedConnection?.lastSyncAt).toBeDefined();
    });

    it('normalizes merchant names', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'normalize-tx',
                merchant_name: 'SQ *COFFEE SHOP #1234',
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      await syncPlaidTransactions(connection);

      const tx = await prisma.transaction.findFirst({
        where: { accountId: testAccountId },
      });
      expect(tx?.merchant).toBe('SQ *COFFEE SHOP #1234');
      // normalizeMerchant removes common prefixes like "SQ *" and store numbers
      expect(tx?.merchantNormalized).toContain('coffee shop');
    });
  });

  describe('dry-run mode', () => {
    it('previews transactions without creating them', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'preview-tx-1',
                merchant_name: 'Coffee Shop',
                amount: 5.5,
              }),
              createMockPlaidTransaction({
                transaction_id: 'preview-tx-2',
                merchant_name: 'Gas Station',
                amount: 45.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
      })) as DryRunResult;

      // Check stats
      expect(result.stats.added).toBe(2);
      expect(result.stats.modified).toBe(0);
      expect(result.stats.removed).toBe(0);

      // Check previews
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].wouldCreate).toBe(true);
      expect(result.transactions[0].action).toBe('add');
      expect(result.transactions[1].wouldCreate).toBe(true);

      // Verify NO transactions were actually created
      const transactions = await prisma.transaction.findMany({
        where: { accountId: testAccountId },
      });
      expect(transactions).toHaveLength(0);
    });

    it('marks duplicates correctly in preview', async () => {
      // Create existing transaction
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

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'existing-tx-1', // Duplicate
                merchant_name: 'Test Merchant',
                amount: 25.0,
              }),
              createMockPlaidTransaction({
                transaction_id: 'new-tx-1', // New
                merchant_name: 'New Merchant',
                amount: 15.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
      })) as DryRunResult;

      expect(result.stats.added).toBe(1);
      expect(result.stats.skippedDuplicates).toBe(1);

      // Find the duplicate preview
      const duplicatePreview = result.transactions.find((t) => t.externalId === 'existing-tx-1');
      expect(duplicatePreview?.wouldCreate).toBe(false);
      expect(duplicatePreview?.skipReason).toContain('duplicate');

      // Find the new transaction preview
      const newPreview = result.transactions.find((t) => t.externalId === 'new-tx-1');
      expect(newPreview?.wouldCreate).toBe(true);
    });

    it('includes auto-categorization info in preview', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'grocery-tx',
                merchant_name: "Trader Joe's", // Should match grocery rule
                amount: 89.42,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
      })) as DryRunResult;

      expect(result.stats.autoCategorized).toBe(1);

      const preview = result.transactions[0];
      expect(preview.category).toBe('Groceries');
      expect(preview.categoryConfidence).toBe(0.98);
    });

    it('does not update enrollment cursor in dry-run mode', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'tx-1',
                merchant_name: 'Store',
                amount: 10.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'should-not-be-saved',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      await syncPlaidTransactions(connection, { dryRun: true });

      // Verify cursor was NOT updated
      const enrollment = await prisma.plaidEnrollment.findUnique({
        where: { id: 'plaid-enroll-1' },
      });
      expect(enrollment?.transactionCursor).toBeNull(); // Should remain null
    });

    it('does not update connection sync status in dry-run mode', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      await syncPlaidTransactions(connection, { dryRun: true });

      // Verify connection was NOT updated
      const plaidConnection = await prisma.plaidConnection.findUnique({
        where: { id: 'plaid-conn-1' },
      });
      expect(plaidConnection?.lastSyncAt).toBeNull();
      expect(plaidConnection?.lastSyncStatus).toBe('never');
    });

    it('includes date range in dry-run result', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
        daysToSync: 30,
      })) as DryRunResult;

      expect(result.dateRange).toBeDefined();
      expect(result.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('previews removed transactions correctly', async () => {
      // Create existing transaction that will be removed
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'remove-tx-1',
          date: new Date(),
          amount: -25,
          merchant: 'To Be Removed',
          merchantNormalized: 'to be removed',
        },
      });

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [],
            removed: [{ transaction_id: 'remove-tx-1' }],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
      })) as DryRunResult;

      expect(result.stats.removed).toBe(1);

      const preview = result.transactions.find((t) => t.action === 'remove');
      expect(preview).toBeDefined();
      expect(preview?.wouldCreate).toBe(true); // "wouldCreate" means "would be removed"
      expect(preview?.merchant).toBe('To Be Removed');

      // Verify transaction was NOT actually removed
      const tx = await prisma.transaction.findFirst({
        where: { externalId: 'remove-tx-1' },
      });
      expect(tx).not.toBeNull();
    });

    it('previews modified transactions correctly', async () => {
      // Create existing transaction
      await prisma.transaction.create({
        data: {
          accountId: testAccountId,
          externalId: 'modify-tx-1',
          date: new Date(),
          amount: -25,
          merchant: 'Old Merchant Name',
          merchantNormalized: 'old merchant name',
        },
      });

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [],
            modified: [
              createMockPlaidTransaction({
                transaction_id: 'modify-tx-1',
                merchant_name: 'Updated Merchant Name',
                amount: 30.0,
              }),
            ],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
      })) as DryRunResult;

      expect(result.stats.modified).toBe(1);

      const preview = result.transactions.find((t) => t.action === 'modify');
      expect(preview).toBeDefined();
      expect(preview?.merchant).toBe('Updated Merchant Name');
      expect(preview?.wouldCreate).toBe(true); // Found existing to modify

      // Verify transaction was NOT actually modified
      const tx = await prisma.transaction.findFirst({
        where: { externalId: 'modify-tx-1' },
      });
      expect(tx?.merchant).toBe('Old Merchant Name'); // Should still be old name
    });

    it('marks old transactions as skipped in preview', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45);

      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({
                transaction_id: 'old-tx-1',
                date: oldDate.toISOString().split('T')[0],
                merchant_name: 'Old Store',
                amount: 25.0,
              }),
            ],
            modified: [],
            removed: [],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
        daysToSync: 30,
      })) as DryRunResult;

      expect(result.stats.skippedOld).toBe(1);

      const preview = result.transactions.find((t) => t.externalId === 'old-tx-1');
      expect(preview?.wouldCreate).toBe(false);
      expect(preview?.skipReason).toContain('older than sync window');
    });

    it('includes totalFetched count', async () => {
      const mockPlaidClient = {
        transactionsSync: vi.fn().mockResolvedValue({
          data: {
            added: [
              createMockPlaidTransaction({ transaction_id: 'tx-1' }),
              createMockPlaidTransaction({ transaction_id: 'tx-2' }),
            ],
            modified: [createMockPlaidTransaction({ transaction_id: 'tx-3' })],
            removed: [{ transaction_id: 'tx-4' }],
            next_cursor: 'cursor-123',
            has_more: false,
          },
        }),
      };

      vi.mocked(getPlaidClient).mockReturnValue(
        mockPlaidClient as unknown as ReturnType<typeof getPlaidClient>
      );

      const connection = createMockPlaidConnection(testAccountId);
      const result = (await syncPlaidTransactions(connection, {
        dryRun: true,
      })) as DryRunResult;

      expect(result.totalFetched).toBe(4); // 2 added + 1 modified + 1 removed
    });
  });
});
