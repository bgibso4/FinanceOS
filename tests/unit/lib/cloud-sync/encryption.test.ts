import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  deriveKey,
  hashPassphrase,
  EncryptionError,
} from '@/lib/cloud-sync/encryption';
import type { SyncPayload } from '@/lib/cloud-sync/types';

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
  describe('deriveKey', () => {
    it('derives a key from passphrase and salt', async () => {
      const passphrase = 'my-secret-passphrase';
      const salt = crypto.getRandomValues(new Uint8Array(32));

      const key = await deriveKey(passphrase, salt);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('produces consistent encryption with same passphrase and salt', async () => {
      // Since keys are non-extractable, we verify by encrypting the same data
      // and checking that decryption works with both keys
      const passphrase = 'consistent-passphrase';
      const salt = new Uint8Array(32).fill(42);
      const iv = new Uint8Array(12).fill(1);
      const testData = new TextEncoder().encode('test-data');

      const key1 = await deriveKey(passphrase, salt);
      const key2 = await deriveKey(passphrase, salt);

      // Encrypt with key1
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, testData);

      // Decrypt with key2 - should work if keys are the same
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, encrypted);

      expect(Array.from(new Uint8Array(decrypted))).toEqual(Array.from(testData));
    });

    it('produces different keys with different passphrases', async () => {
      // Verify that different passphrases produce different keys by checking
      // that decryption fails with wrong passphrase
      const salt = new Uint8Array(32).fill(42);
      const iv = new Uint8Array(12).fill(1);
      const testData = new TextEncoder().encode('test-data');

      const key1 = await deriveKey('passphrase-one', salt);
      const key2 = await deriveKey('passphrase-two', salt);

      // Encrypt with key1
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, testData);

      // Decrypt with key2 should fail
      await expect(
        crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, encrypted)
      ).rejects.toThrow();
    });

    it('produces different keys with different salts', async () => {
      // Verify that different salts produce different keys
      const passphrase = 'same-passphrase';
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);
      const iv = new Uint8Array(12).fill(1);
      const testData = new TextEncoder().encode('test-data');

      const key1 = await deriveKey(passphrase, salt1);
      const key2 = await deriveKey(passphrase, salt2);

      // Encrypt with key1
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, testData);

      // Decrypt with key2 should fail
      await expect(
        crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, encrypted)
      ).rejects.toThrow();
    });
  });

  describe('hashPassphrase', () => {
    it('hashes a passphrase', async () => {
      const passphrase = 'test-passphrase';
      const hash = await hashPassphrase(passphrase);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('produces consistent hash for same passphrase', async () => {
      const passphrase = 'consistent-test';

      const hash1 = await hashPassphrase(passphrase);
      const hash2 = await hashPassphrase(passphrase);

      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different passphrases', async () => {
      const hash1 = await hashPassphrase('passphrase-one');
      const hash2 = await hashPassphrase('passphrase-two');

      expect(hash1).not.toBe(hash2);
    });

    it('produces valid hex string', async () => {
      const hash = await hashPassphrase('any-passphrase');

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('encrypt', () => {
    it('encrypts a payload to ArrayBuffer', async () => {
      const payload = createTestPayload();
      const passphrase = 'encryption-test-pass';

      const encrypted = await encrypt(payload, passphrase);

      expect(encrypted).toBeInstanceOf(ArrayBuffer);
      expect(encrypted.byteLength).toBeGreaterThan(52); // Header size
    });

    it('produces blob with correct magic number', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload, 'test-pass');

      const bytes = new Uint8Array(encrypted);
      // Magic number: 0x46 0x4F 0x53 0x31 = "FOS1"
      expect(bytes[0]).toBe(0x46); // F
      expect(bytes[1]).toBe(0x4f); // O
      expect(bytes[2]).toBe(0x53); // S
      expect(bytes[3]).toBe(0x31); // 1
    });

    it('produces blob with version 1', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload, 'test-pass');

      const bytes = new Uint8Array(encrypted);
      // Version at offset 4-5 (little-endian uint16)
      expect(bytes[4]).toBe(1);
      expect(bytes[5]).toBe(0);
    });

    it('produces blob with gzip flag set', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload, 'test-pass');

      const bytes = new Uint8Array(encrypted);
      // Flags at offset 6-7 (little-endian uint16), gzip flag = 0x0001
      expect(bytes[6]).toBe(1);
      expect(bytes[7]).toBe(0);
    });

    it('produces different ciphertext each time (random IV)', async () => {
      const payload = createTestPayload();
      const passphrase = 'same-passphrase';

      const encrypted1 = await encrypt(payload, passphrase);
      const encrypted2 = await encrypt(payload, passphrase);

      // The ciphertext portion should differ due to random salt and IV
      const bytes1 = new Uint8Array(encrypted1);
      const bytes2 = new Uint8Array(encrypted2);

      // Salt is at offset 8-39, should be different
      const salt1 = bytes1.slice(8, 40);
      const salt2 = bytes2.slice(8, 40);
      expect(salt1).not.toEqual(salt2);
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

      const encrypted = await encrypt(payload, 'test-pass');
      const jsonSize = JSON.stringify(payload).length;

      // Compressed + encrypted should be smaller than raw JSON
      // (accounting for some overhead from encryption)
      expect(encrypted.byteLength).toBeLessThan(jsonSize);
    });
  });

  describe('decrypt', () => {
    it('decrypts an encrypted payload correctly', async () => {
      const originalPayload = createTestPayload();
      const passphrase = 'decrypt-test-pass';

      const encrypted = await encrypt(originalPayload, passphrase);
      const decrypted = await decrypt(encrypted, passphrase);

      expect(decrypted).toEqual(originalPayload);
    });

    it('preserves all payload fields through encrypt/decrypt cycle', async () => {
      const payload = createTestPayload();
      const passphrase = 'field-preservation-test';

      const encrypted = await encrypt(payload, passphrase);
      const decrypted = await decrypt(encrypted, passphrase);

      expect(decrypted.version).toBe(payload.version);
      expect(decrypted.exportedAt).toBe(payload.exportedAt);
      expect(decrypted.deviceId).toBe(payload.deviceId);
      expect(decrypted.data.accounts).toHaveLength(1);
      expect(decrypted.data.accounts[0].name).toBe('Test Account');
      expect(decrypted.data.transactions).toHaveLength(1);
      expect(decrypted.data.transactions[0].amount).toBe(-50.0);
      expect(decrypted.metadata.checksum).toBe(payload.metadata.checksum);
    });

    it('throws EncryptionError with wrong passphrase', async () => {
      const payload = createTestPayload();

      const encrypted = await encrypt(payload, 'correct-passphrase');

      await expect(decrypt(encrypted, 'wrong-passphrase')).rejects.toThrow(EncryptionError);
      await expect(decrypt(encrypted, 'wrong-passphrase')).rejects.toMatchObject({
        code: 'WRONG_PASSPHRASE',
      });
    });

    it('throws EncryptionError for invalid blob (too small)', async () => {
      const tooSmall = new ArrayBuffer(20);

      await expect(decrypt(tooSmall, 'any-pass')).rejects.toThrow(EncryptionError);
      await expect(decrypt(tooSmall, 'any-pass')).rejects.toMatchObject({
        code: 'INVALID_FORMAT',
      });
    });

    it('throws EncryptionError for invalid magic number', async () => {
      const invalidBlob = new Uint8Array(100);
      invalidBlob[0] = 0x00; // Wrong magic
      invalidBlob[1] = 0x00;
      invalidBlob[2] = 0x00;
      invalidBlob[3] = 0x00;

      await expect(decrypt(invalidBlob.buffer, 'any-pass')).rejects.toThrow(EncryptionError);
      await expect(decrypt(invalidBlob.buffer, 'any-pass')).rejects.toMatchObject({
        code: 'INVALID_FORMAT',
      });
    });

    it('throws EncryptionError for unsupported version', async () => {
      const payload = createTestPayload();
      const encrypted = await encrypt(payload, 'test-pass');

      // Modify version to 99
      const bytes = new Uint8Array(encrypted);
      bytes[4] = 99;
      bytes[5] = 0;

      await expect(decrypt(bytes.buffer, 'test-pass')).rejects.toThrow(EncryptionError);
      await expect(decrypt(bytes.buffer, 'test-pass')).rejects.toMatchObject({
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

      const passphrase = 'empty-test-pass';
      const encrypted = await encrypt(payload, passphrase);
      const decrypted = await decrypt(encrypted, passphrase);

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

      const passphrase = 'unicode-test-pass';
      const encrypted = await encrypt(payload, passphrase);
      const decrypted = await decrypt(encrypted, passphrase);

      expect(decrypted.data.accounts[0].name).toBe('日本語アカウント 🏦');
      expect(decrypted.data.accounts[0].institution).toBe('Банк России');
      expect(decrypted.data.transactions[0].merchant).toBe('Café Müller');
      expect(decrypted.data.transactions[0].note).toBe('Payment for 中文商品');
    });

    it('handles special characters in passphrase', async () => {
      const payload = createTestPayload();
      const specialPassphrase = 'p@$$w0rd!#$%^&*()_+-=[]{}|;:,.<>?';

      const encrypted = await encrypt(payload, specialPassphrase);
      const decrypted = await decrypt(encrypted, specialPassphrase);

      expect(decrypted).toEqual(payload);
    });

    it('handles very long passphrase', async () => {
      const payload = createTestPayload();
      const longPassphrase = 'x'.repeat(10000);

      const encrypted = await encrypt(payload, longPassphrase);
      const decrypted = await decrypt(encrypted, longPassphrase);

      expect(decrypted).toEqual(payload);
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

      const passphrase = 'bulk-test-pass';
      const encrypted = await encrypt(payload, passphrase);
      const decrypted = await decrypt(encrypted, passphrase);

      expect(decrypted.data.transactions).toHaveLength(1000);
      expect(decrypted.data.transactions[999].merchant).toBe('Merchant 999');
    });
  });

  describe('EncryptionError', () => {
    it('has correct properties', () => {
      const error = new EncryptionError('Test message', 'WRONG_PASSPHRASE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(EncryptionError);
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('WRONG_PASSPHRASE');
      expect(error.name).toBe('EncryptionError');
    });

    it('supports all error codes', () => {
      const codes = [
        'INVALID_FORMAT',
        'WRONG_PASSPHRASE',
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
