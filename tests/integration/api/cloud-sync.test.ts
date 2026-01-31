import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createTransactionData,
  createCategoryData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import {
  exportDatabase,
  importDatabase,
  getRecordCounts,
  generateChecksum,
  setPrismaClient,
  resetPrismaClient,
} from '@/lib/cloud-sync/sync';
import { encrypt, decrypt } from '@/lib/cloud-sync/encryption';
import type { SyncPayload } from '@/lib/cloud-sync/types';
import { validateSyncPayload, isSyncPayload } from '@/lib/cloud-sync/types';

describe('cloud-sync integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    // Set the sync module to use the test database
    setPrismaClient(prisma);
  });

  afterAll(async () => {
    // Reset to default prisma client
    resetPrismaClient();
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  describe('exportDatabase', () => {
    it('exports empty database', async () => {
      const payload = await exportDatabase();

      expect(payload.version).toBe(1);
      expect(payload.deviceId).toBeDefined();
      expect(payload.exportedAt).toBeDefined();
      expect(payload.data.accounts).toHaveLength(0);
      expect(payload.data.transactions).toHaveLength(0);
      expect(payload.data.categories).toHaveLength(0);
      expect(payload.metadata.recordCounts.accounts).toBe(0);
      expect(payload.metadata.recordCounts.transactions).toBe(0);
    });

    it('exports accounts with all fields', async () => {
      await prisma.account.create({
        data: {
          ...createAccountData({
            name: 'Test Checking',
            type: 'checking',
            institution: 'Test Bank',
            currency: 'USD',
            isActive: true,
            notes: 'Primary account',
          }),
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
        },
      });

      const payload = await exportDatabase();

      expect(payload.data.accounts).toHaveLength(1);
      const account = payload.data.accounts[0];
      expect(account.name).toBe('Test Checking');
      expect(account.type).toBe('checking');
      expect(account.institution).toBe('Test Bank');
      expect(account.currency).toBe('USD');
      expect(account.isActive).toBe(true);
      expect(account.notes).toBe('Primary account');
      expect(account.trackingMode).toBe('cash_flow');
      expect(account.invertAmounts).toBe(false);
      expect(account.sortOrder).toBe(0);
    });

    it('exports transactions with all fields', async () => {
      const account = await prisma.account.create({
        data: createAccountData({ name: 'Test Account' }),
      });

      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Food & Drink', type: 'expense' }),
      });

      await prisma.transaction.create({
        data: createTransactionData(account.id, {
          categoryId: category.id,
          date: new Date('2024-01-15'),
          amount: -42.5,
          merchant: 'Coffee Shop',
          merchantNormalized: 'coffee shop',
          note: 'Morning coffee',
          tags: '["coffee","breakfast"]',
          confidenceScore: 0.95,
          isTransfer: false,
        }),
      });

      const payload = await exportDatabase();

      expect(payload.data.transactions).toHaveLength(1);
      const txn = payload.data.transactions[0];
      expect(txn.amount).toBe(-42.5);
      expect(txn.merchant).toBe('Coffee Shop');
      expect(txn.merchantNormalized).toBe('coffee shop');
      expect(txn.note).toBe('Morning coffee');
      expect(txn.categoryId).toBe(category.id);
      expect(txn.accountId).toBe(account.id);
      expect(txn.confidenceScore).toBe(0.95);
      expect(txn.isTransfer).toBe(false);
    });

    it('exports categories including hierarchy', async () => {
      const parent = await prisma.category.create({
        data: createCategoryData({ name: 'Food & Drink', type: 'expense' }),
      });

      await prisma.category.create({
        data: createCategoryData({ name: 'Coffee', type: 'expense', parentId: parent.id }),
      });

      const payload = await exportDatabase();

      expect(payload.data.categories).toHaveLength(2);
      const child = payload.data.categories.find((c) => c.name === 'Coffee');
      expect(child?.parentId).toBe(parent.id);
    });

    it('exports rules', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Coffee', type: 'expense' }),
      });

      await prisma.rule.create({
        data: {
          conditions: JSON.stringify([
            { field: 'merchant', operator: 'contains', value: 'starbucks' },
          ]),
          categoryId: category.id,
          renameTo: 'Starbucks',
          priority: 10,
          isEnabled: true,
        },
      });

      const payload = await exportDatabase();

      expect(payload.data.rules).toHaveLength(1);
      const conditions = JSON.parse(payload.data.rules[0].conditions);
      expect(conditions[0].value).toBe('starbucks');
      expect(payload.data.rules[0].categoryId).toBe(category.id);
      expect(payload.data.rules[0].renameTo).toBe('Starbucks');
    });

    it('exports user settings', async () => {
      await prisma.userSettings.create({
        data: { baseCurrency: 'CAD' },
      });

      const payload = await exportDatabase();

      expect(payload.data.settings).not.toBeNull();
      expect(payload.data.settings?.baseCurrency).toBe('CAD');
    });

    it('does NOT export Plaid enrollments', async () => {
      await prisma.plaidEnrollment.create({
        data: {
          plaidItemId: 'plaid-item-123',
          accessTokenEncrypted: 'encrypted-access-token',
          accessTokenIv: 'test-iv-value',
          institutionId: 'ins_123',
          institutionName: 'Test Bank',
          status: 'active',
        },
      });

      const payload = await exportDatabase();

      // Verify export doesn't include plaid data by checking the payload structure
      expect('plaidEnrollments' in payload.data).toBe(false);
    });

    it('does NOT export Teller enrollments', async () => {
      await prisma.tellerEnrollment.create({
        data: {
          enrollmentId: 'teller-enrollment-123',
          institutionId: 'test_credit_union',
          accessTokenEncrypted: 'encrypted-teller-token',
          accessTokenIv: 'teller-iv-value',
          institutionName: 'Test Credit Union',
          status: 'connected',
        },
      });

      const payload = await exportDatabase();

      // Verify export doesn't include teller data
      expect('tellerEnrollments' in payload.data).toBe(false);
    });

    it('generates valid checksum', async () => {
      await prisma.account.create({
        data: createAccountData({ name: 'Test Account' }),
      });

      const payload = await exportDatabase();

      expect(payload.metadata.checksum).toBeDefined();
      expect(payload.metadata.checksum.length).toBe(64); // SHA-256 hex
    });

    it('validates payload structure with Zod', async () => {
      const payload = await exportDatabase();

      expect(() => validateSyncPayload(payload)).not.toThrow();
      expect(isSyncPayload(payload)).toBe(true);
    });
  });

  describe('importDatabase', () => {
    it('imports accounts', async () => {
      const payload = createTestPayloadData();
      payload.data.accounts = [
        {
          id: 'acc-import-1',
          name: 'Imported Checking',
          type: 'checking',
          institution: 'Imported Bank',
          currency: 'USD',
          isActive: true,
          notes: null,
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ];
      payload.metadata.recordCounts.accounts = 1;

      await importDatabase(await finalizePayload(payload));

      const accounts = await prisma.account.findMany();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Imported Checking');
      expect(accounts[0].institution).toBe('Imported Bank');
    });

    it('imports transactions with category references', async () => {
      const payload = createTestPayloadData();
      payload.data.categories = [
        {
          id: 'cat-import-1',
          name: 'Groceries',
          parentId: null,
          type: 'expense',
          createdAt: new Date().toISOString(),
        },
      ];
      payload.data.accounts = [
        {
          id: 'acc-import-1',
          name: 'Test Account',
          type: 'checking',
          institution: null,
          currency: 'USD',
          isActive: true,
          notes: null,
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ];
      payload.data.transactions = [
        {
          id: 'txn-import-1',
          date: '2024-01-15',
          amount: -50,
          accountId: 'acc-import-1',
          merchant: 'Grocery Store',
          merchantNormalized: 'grocery store',
          categoryId: 'cat-import-1',
          tags: null,
          note: null,
          isTransfer: false,
          transferGroupId: null,
          confidenceScore: 0.9,
          externalId: null,
          importHash: null,
          isOffset: false,
          linkedTransactionId: null,
          createdAt: new Date().toISOString(),
        },
      ];
      payload.metadata.recordCounts.accounts = 1;
      payload.metadata.recordCounts.categories = 1;
      payload.metadata.recordCounts.transactions = 1;

      await importDatabase(await finalizePayload(payload));

      const transactions = await prisma.transaction.findMany({
        include: { category: true },
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0].merchant).toBe('Grocery Store');
      expect(transactions[0].category?.name).toBe('Groceries');
    });

    it('replaces existing data', async () => {
      // Create initial data
      await prisma.account.create({
        data: createAccountData({ name: 'Old Account' }),
      });

      // Import new data
      const payload = createTestPayloadData();
      payload.data.accounts = [
        {
          id: 'acc-new-1',
          name: 'New Account',
          type: 'checking',
          institution: null,
          currency: 'USD',
          isActive: true,
          notes: null,
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ];
      payload.metadata.recordCounts.accounts = 1;

      await importDatabase(await finalizePayload(payload));

      const accounts = await prisma.account.findMany();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('New Account');
    });

    it('preserves Plaid connections during import', async () => {
      // Create account with Plaid connection
      const account = await prisma.account.create({
        data: createAccountData({ name: 'Linked Account' }),
      });

      const enrollment = await prisma.plaidEnrollment.create({
        data: {
          plaidItemId: 'plaid-item-123',
          accessTokenEncrypted: 'encrypted-access-token',
          accessTokenIv: 'test-iv-value',
          institutionId: 'ins_123',
          institutionName: 'Test Bank',
          status: 'active',
        },
      });

      await prisma.plaidConnection.create({
        data: {
          accountId: account.id,
          plaidEnrollmentId: enrollment.id,
          plaidAccountId: 'plaid-acc-123',
          status: 'active',
          lastSyncStatus: 'success',
        },
      });

      // Import (which replaces accounts)
      const payload = createTestPayloadData();
      payload.data.accounts = [
        {
          id: 'acc-new-1',
          name: 'New Account',
          type: 'checking',
          institution: null,
          currency: 'USD',
          isActive: true,
          notes: null,
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ];
      payload.metadata.recordCounts.accounts = 1;

      await importDatabase(await finalizePayload(payload));

      // Plaid enrollment should still exist
      const enrollments = await prisma.plaidEnrollment.findMany();
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].accessTokenEncrypted).toBe('encrypted-access-token');
    });

    it('preserves Teller connections during import', async () => {
      // Create Teller enrollment
      await prisma.tellerEnrollment.create({
        data: {
          enrollmentId: 'teller-enrollment-123',
          institutionId: 'test_credit_union',
          accessTokenEncrypted: 'encrypted-teller-token',
          accessTokenIv: 'teller-iv-value',
          institutionName: 'Test Credit Union',
          status: 'connected',
        },
      });

      // Import (which should preserve Teller data)
      const payload = createTestPayloadData();
      await importDatabase(await finalizePayload(payload));

      // Teller enrollment should still exist
      const enrollments = await prisma.tellerEnrollment.findMany();
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].accessTokenEncrypted).toBe('encrypted-teller-token');
    });

    it('imports budgets', async () => {
      const payload = createTestPayloadData();
      payload.data.categories = [
        {
          id: 'cat-1',
          name: 'Groceries',
          parentId: null,
          type: 'expense',
          createdAt: new Date().toISOString(),
        },
      ];
      payload.data.budgets = [
        {
          id: 'budget-1',
          month: '2024-01',
          categoryId: 'cat-1',
          limitAmount: 500,
          createdAt: new Date().toISOString(),
        },
      ];
      payload.metadata.recordCounts.categories = 1;
      payload.metadata.recordCounts.budgets = 1;

      await importDatabase(await finalizePayload(payload));

      const budgets = await prisma.categoryBudget.findMany();
      expect(budgets).toHaveLength(1);
      expect(budgets[0].limitAmount).toBe(500);
    });
  });

  describe('getRecordCounts', () => {
    it('returns accurate counts', async () => {
      const account = await prisma.account.create({
        data: createAccountData({ name: 'Test Account' }),
      });

      await prisma.category.createMany({
        data: [
          createCategoryData({ name: 'Cat 1' }),
          createCategoryData({ name: 'Cat 2' }),
          createCategoryData({ name: 'Cat 3' }),
        ],
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(account.id, { merchant: 'M1' }),
          createTransactionData(account.id, { merchant: 'M2' }),
        ],
      });

      const counts = await getRecordCounts();

      expect(counts.accounts).toBe(1);
      expect(counts.categories).toBe(3);
      expect(counts.transactions).toBe(2);
      expect(counts.rules).toBe(0);
      expect(counts.budgets).toBe(0);
    });
  });

  describe('generateChecksum', () => {
    it('produces consistent checksum for same data', async () => {
      const payload = createTestPayloadData();

      const checksum1 = await generateChecksum(payload.data);
      const checksum2 = await generateChecksum(payload.data);

      expect(checksum1).toBe(checksum2);
    });

    it('produces different checksum for different data', async () => {
      const payload1 = createTestPayloadData();
      const payload2 = createTestPayloadData();
      payload2.data.accounts = [
        {
          id: 'acc-1',
          name: 'Different Account',
          type: 'checking',
          institution: null,
          currency: 'USD',
          isActive: true,
          notes: null,
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ];

      const checksum1 = await generateChecksum(payload1.data);
      const checksum2 = await generateChecksum(payload2.data);

      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('full sync round-trip', () => {
    it('exports, encrypts, decrypts, and imports correctly', async () => {
      // Create test data
      const account = await prisma.account.create({
        data: createAccountData({
          name: 'Round Trip Account',
          type: 'checking',
          institution: 'Test Bank',
        }),
      });

      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Test Category', type: 'expense' }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(account.id, {
            categoryId: category.id,
            merchant: 'Transaction 1',
            amount: -100,
          }),
          createTransactionData(account.id, {
            categoryId: category.id,
            merchant: 'Transaction 2',
            amount: -200,
          }),
        ],
      });

      await prisma.rule.create({
        data: {
          conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'test' }]),
          categoryId: category.id,
          priority: 1,
          isEnabled: true,
        },
      });

      // Export
      const exportedPayload = await exportDatabase();

      // Encrypt
      const passphrase = 'integration-test-passphrase-12345';
      const encrypted = await encrypt(exportedPayload, passphrase);

      // Decrypt
      const decrypted = await decrypt(encrypted, passphrase);

      // Validate payload structure
      expect(isSyncPayload(decrypted)).toBe(true);

      // Clear database and import
      await resetTestDb();
      await importDatabase(decrypted);

      // Verify data was restored
      const accounts = await prisma.account.findMany();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Round Trip Account');

      const categories = await prisma.category.findMany();
      expect(categories).toHaveLength(1);
      expect(categories[0].name).toBe('Test Category');

      const transactions = await prisma.transaction.findMany();
      expect(transactions).toHaveLength(2);

      const rules = await prisma.rule.findMany();
      expect(rules).toHaveLength(1);
      const conditions = JSON.parse(rules[0].conditions);
      expect(conditions[0].value).toBe('test');
    });

    it('handles unicode data through full cycle', async () => {
      await prisma.account.create({
        data: createAccountData({
          name: '日本語アカウント 🏦',
          institution: 'Банк России',
        }),
      });

      const payload = await exportDatabase();
      const encrypted = await encrypt(payload, 'unicode-test');
      const decrypted = await decrypt(encrypted, 'unicode-test');

      await resetTestDb();
      await importDatabase(decrypted);

      const accounts = await prisma.account.findMany();
      expect(accounts[0].name).toBe('日本語アカウント 🏦');
      expect(accounts[0].institution).toBe('Банк России');
    });
  });
});

// Helper function to create a minimal valid payload
function createTestPayloadData(): SyncPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceId: 'test-device-123',
    data: {
      accounts: [],
      transactions: [],
      categories: [],
      rules: [],
      budgets: [],
      monthlySnapshots: [],
      netWorthSnapshots: [],
      exchangeRates: [],
      settings: null,
    },
    metadata: {
      recordCounts: {
        accounts: 0,
        transactions: 0,
        categories: 0,
        rules: 0,
        budgets: 0,
        monthlySnapshots: 0,
        netWorthSnapshots: 0,
        exchangeRates: 0,
      },
      checksum: '', // Will be updated by finalizePayload
    },
  };
}

// Helper to finalize payload with correct checksum after modifications
async function finalizePayload(payload: SyncPayload): Promise<SyncPayload> {
  payload.metadata.checksum = await generateChecksum(payload.data);
  return payload;
}
