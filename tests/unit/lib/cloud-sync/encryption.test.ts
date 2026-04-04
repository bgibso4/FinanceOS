import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  generateEncryptionKey,
  getEncryptionKey,
  EncryptionError,
} from '@/lib/cloud-sync/encryption';
import type { SyncPayload } from '@/lib/cloud-sync/types';

// Generate a test key and set it in the env before each test
const TEST_KEY = 'YV10ZXN0LWtleS10aGF0LWlzLWV4YWN0bHktMzItYiE='; // 32 bytes base64

function setTestKey(key?: string): void {
  process.env.SYNC_ENCRYPTION_KEY = key ?? TEST_KEY;
}

function clearTestKey(): void {
  delete process.env.SYNC_ENCRYPTION_KEY;
}

// Create a minimal valid sync payload for testing
function createTestPayload(): SyncPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceId: 'test-device-123',
    data: {
      accounts: [
        {
          id: 'acc-1',
          name: 'Test Account',
          type: 'checking',
          institution: 'Test Bank',
          currency: 'USD',
          isActive: true,
          notes: null,
          trackingMode: 'cash_flow',
          invertAmounts: false,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ],
      transactions: [
        {
          id: 'txn-1',
          date: '2024-01-15',
          amount: -50.0,
          accountId: 'acc-1',
          merchant: 'Coffee Shop',
          merchantNormalized: 'coffee shop',
          categoryId: 'cat-1',
          tags: null,
          note: null,
          isTransfer: false,
          transferGroupId: null,
          confidenceScore: 0.98,
          externalId: null,
          importHash: null,
          isOffset: false,
          linkedTransactionId: null,
          isSplitParent: false,
          parentTransactionId: null,
          createdAt: new Date().toISOString(),
        },
      ],
      categories: [
        {
          id: 'cat-1',
          name: 'Food & Drink',
          parentId: null,
          type: 'expense',
          createdAt: new Date().toISOString(),
        },
      ],
      rules: [],
      budgets: [],
      monthlySnapshots: [],
      netWorthSnapshots: [],
      exchangeRates: [],
      settings: {
        id: 'settings-1',
        baseCurrency: 'USD',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    },
    metadata: {
      recordCounts: {
        accounts: 1,
        transactions: 1,
        categories: 1,
        rules: 0,
        budgets: 0,
        monthlySnapshots: 0,
        netWorthSnapshots: 0,
        exchangeRates: 0,
      },
      checksum: 'test-checksum-123',
    },
  };
}

describe('cloud-sync/encryption', () => {
  beforeEach(() => {
    setTestKey();
  });

  afterEach(() => {
    clearTestKey();
  });

  describe('generateEncryptionKey', () => {
    it('generates a valid base64-encoded 32-byte key', () => {
      const key = generateEncryptionKey();

      expect(typeof key).toBe('string');
      // Decode and verify length
      const binary = atob(key);
      expect(binary.length).toBe(32);
    });

    it('generates unique keys each time', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('getEncryptionKey', () => {
    it('returns a CryptoKey from env var', async () => {
      const key = await getEncryptionKey();

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('throws MISSING_KEY when env var is not set', async () => {
      clearTestKey();

      await expect(getEncryptionKey()).rejects.toThrow(EncryptionError);
      await expect(getEncryptionKey()).rejects.toMatchObject({
        code: 'MISSING_KEY',
      });
    });
  });

  describe('encrypt', () => {
    it('encrypts a payload to ArrayBuffer', async () => {
      const payload = createTestPayload();

      const encrypted = await encrypt(payload);

      expect(encrypted).toBeInstanceOf(ArrayBuffer);
      expect(encrypted.byteLength).toBeGreaterThan(52); // Header size
    });

    it('produces blob with correct magic number', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload);

      const bytes = new Uint8Array(encrypted);
      // Magic number: 0x46 0x4F 0x53 0x31 = "FOS1"
      expect(bytes[0]).toBe(0x46); // F
      expect(bytes[1]).toBe(0x4f); // O
      expect(bytes[2]).toBe(0x53); // S
      expect(bytes[3]).toBe(0x31); // 1
    });

    it('produces blob with version 1', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload);

      const bytes = new Uint8Array(encrypted);
      // Version at offset 4-5 (little-endian uint16)
      expect(bytes[4]).toBe(1);
      expect(bytes[5]).toBe(0);
    });

    it('produces blob with gzip flag set', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload);

      const bytes = new Uint8Array(encrypted);
      // Flags at offset 6-7 (little-endian uint16), gzip flag = 0x0001
      expect(bytes[6]).toBe(1);
      expect(bytes[7]).toBe(0);
    });

    it('produces different ciphertext each time (random IV)', async () => {
      const payload = createTestPayload();

      const encrypted1 = await encrypt(payload);
      const encrypted2 = await encrypt(payload);

      // The IV portion should differ due to random generation
      const bytes1 = new Uint8Array(encrypted1);
      const bytes2 = new Uint8Array(encrypted2);

      // IV is at offset 40-51, should be different
      const iv1 = bytes1.slice(40, 52);
      const iv2 = bytes2.slice(40, 52);
      expect(Array.from(iv1)).not.toEqual(Array.from(iv2));
    });

    it('compresses data effectively', async () => {
      // Create a larger payload with repetitive data
      const payload = createTestPayload();
      for (let i = 0; i < 100; i++) {
        payload.data.transactions.push({
          id: `txn-${i + 2}`,
          date: '2024-01-15',
          amount: -10.0,
          accountId: 'acc-1',
          merchant: 'Same Store',
          merchantNormalized: 'same store',
          categoryId: 'cat-1',
          tags: null,
          note: null,
          isTransfer: false,
          transferGroupId: null,
          confidenceScore: 0.98,
          externalId: null,
          importHash: null,
          isOffset: false,
          linkedTransactionId: null,
          isSplitParent: false,
          parentTransactionId: null,
          createdAt: new Date().toISOString(),
        });
      }

      const encrypted = await encrypt(payload);
      const jsonSize = JSON.stringify(payload).length;

      // Compressed + encrypted should be smaller than raw JSON
      expect(encrypted.byteLength).toBeLessThan(jsonSize);
    });
  });

  describe('decrypt', () => {
    it('decrypts an encrypted payload correctly', async () => {
      const originalPayload = createTestPayload();

      const encrypted = await encrypt(originalPayload);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toEqual(originalPayload);
    });

    it('preserves all payload fields through encrypt/decrypt cycle', async () => {
      const payload = createTestPayload();

      const encrypted = await encrypt(payload);
      const decrypted = await decrypt(encrypted);

      expect(decrypted.version).toBe(payload.version);
      expect(decrypted.exportedAt).toBe(payload.exportedAt);
      expect(decrypted.deviceId).toBe(payload.deviceId);
      expect(decrypted.data.accounts).toHaveLength(1);
      expect(decrypted.data.accounts[0].name).toBe('Test Account');
      expect(decrypted.data.transactions).toHaveLength(1);
      expect(decrypted.data.transactions[0].amount).toBe(-50.0);
      expect(decrypted.metadata.checksum).toBe(payload.metadata.checksum);
    });

    it('throws EncryptionError with wrong key', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload);

      // Switch to a different key for decryption
      const differentKey = generateEncryptionKey();
      setTestKey(differentKey);

      await expect(decrypt(encrypted)).rejects.toThrow(EncryptionError);
      await expect(decrypt(encrypted)).rejects.toMatchObject({
        code: 'WRONG_KEY',
      });
    });

    it('throws EncryptionError for invalid blob (too small)', async () => {
      const tooSmall = new ArrayBuffer(20);

      await expect(decrypt(tooSmall)).rejects.toThrow(EncryptionError);
      await expect(decrypt(tooSmall)).rejects.toMatchObject({
        code: 'INVALID_FORMAT',
      });
    });

    it('throws EncryptionError for invalid magic number', async () => {
      const invalidBlob = new Uint8Array(100);
      invalidBlob[0] = 0x00; // Wrong magic
      invalidBlob[1] = 0x00;
      invalidBlob[2] = 0x00;
      invalidBlob[3] = 0x00;

      await expect(decrypt(invalidBlob.buffer)).rejects.toThrow(EncryptionError);
      await expect(decrypt(invalidBlob.buffer)).rejects.toMatchObject({
        code: 'INVALID_FORMAT',
      });
    });

    it('throws EncryptionError for unsupported version', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload);

      // Modify version to 99
      const bytes = new Uint8Array(encrypted);
      bytes[4] = 99;
      bytes[5] = 0;

      await expect(decrypt(bytes.buffer)).rejects.toThrow(EncryptionError);
      await expect(decrypt(bytes.buffer)).rejects.toMatchObject({
        code: 'UNSUPPORTED_VERSION',
      });
    });
  });

  describe('round-trip with various data', () => {
    it('handles empty arrays', async () => {
      const payload: SyncPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        deviceId: 'empty-test',
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
          checksum: 'empty-checksum',
        },
      };

      const encrypted = await encrypt(payload);
      const decrypted = await decrypt(encrypted);

      expect(decrypted.data.accounts).toHaveLength(0);
      expect(decrypted.data.transactions).toHaveLength(0);
      expect(decrypted.data.settings).toBeNull();
    });

    it('handles unicode characters', async () => {
      const payload = createTestPayload();
      payload.data.accounts[0].name = '日本語アカウント 🏦';
      payload.data.accounts[0].institution = 'Банк России';
      payload.data.transactions[0].merchant = 'Café Müller';
      payload.data.transactions[0].note = 'Payment for 中文商品';

      const encrypted = await encrypt(payload);
      const decrypted = await decrypt(encrypted);

      expect(decrypted.data.accounts[0].name).toBe('日本語アカウント 🏦');
      expect(decrypted.data.accounts[0].institution).toBe('Банк России');
      expect(decrypted.data.transactions[0].merchant).toBe('Café Müller');
      expect(decrypted.data.transactions[0].note).toBe('Payment for 中文商品');
    });

    it('handles large number of transactions', async () => {
      const payload = createTestPayload();
      payload.data.transactions = [];

      // Add 1000 transactions
      for (let i = 0; i < 1000; i++) {
        payload.data.transactions.push({
          id: `txn-${i}`,
          date: '2024-01-15',
          amount: -(i + 1) * 0.01,
          accountId: 'acc-1',
          merchant: `Merchant ${i}`,
          merchantNormalized: `merchant ${i}`,
          categoryId: i % 2 === 0 ? 'cat-1' : null,
          tags: null,
          note: null,
          isTransfer: false,
          transferGroupId: null,
          confidenceScore: 0.72,
          externalId: null,
          importHash: null,
          isOffset: false,
          linkedTransactionId: null,
          isSplitParent: false,
          parentTransactionId: null,
          createdAt: new Date().toISOString(),
        });
      }
      payload.metadata.recordCounts.transactions = 1000;

      const encrypted = await encrypt(payload);
      const decrypted = await decrypt(encrypted);

      expect(decrypted.data.transactions).toHaveLength(1000);
      expect(decrypted.data.transactions[999].merchant).toBe('Merchant 999');
    });
  });

  describe('EncryptionError', () => {
    it('has correct properties', () => {
      const error = new EncryptionError('Test message', 'WRONG_KEY');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(EncryptionError);
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('WRONG_KEY');
      expect(error.name).toBe('EncryptionError');
    });

    it('supports all error codes', () => {
      const codes = [
        'INVALID_FORMAT',
        'WRONG_KEY',
        'MISSING_KEY',
        'CORRUPTED',
        'UNSUPPORTED_VERSION',
      ] as const;

      for (const code of codes) {
        const error = new EncryptionError(`Error: ${code}`, code);
        expect(error.code).toBe(code);
      }
    });
  });
});
