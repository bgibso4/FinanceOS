import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('accounts API integration', () => {
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

  describe('GET accounts', () => {
    it('returns empty array when no accounts exist', async () => {
      const accounts = await prisma.account.findMany();
      expect(accounts).toHaveLength(0);
    });

    it('returns all accounts ordered by createdAt desc', async () => {
      // Create accounts with different timestamps
      const account1 = createAccountData({ name: 'First Account' });
      const account2 = createAccountData({ name: 'Second Account' });

      await prisma.account.create({ data: account1 });
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      await prisma.account.create({ data: account2 });

      const accounts = await prisma.account.findMany({
        orderBy: { createdAt: 'desc' },
      });

      expect(accounts).toHaveLength(2);
      expect(accounts[0].name).toBe('Second Account');
      expect(accounts[1].name).toBe('First Account');
    });

    it('includes plaid connection info when present', async () => {
      const account = createAccountData({ name: 'Plaid Account' });
      const created = await prisma.account.create({ data: account });

      await prisma.plaidConnection.create({
        data: {
          accountId: created.id,
          plaidItemId: 'item-plaid-123', // Required field
          plaidAccountId: 'plaid-123',
          accessTokenEncrypted: 'encrypted-token',
          accessTokenIv: 'iv-value',
          status: 'active',
          institutionName: 'Chase',
          lastSyncStatus: 'success',
        },
      });

      const result = await prisma.account.findFirst({
        where: { id: created.id },
        include: {
          plaidConnection: {
            select: {
              id: true,
              status: true,
              lastSyncAt: true,
              lastSyncStatus: true,
              institutionName: true,
            },
          },
        },
      });

      expect(result?.plaidConnection).toBeDefined();
      expect(result?.plaidConnection?.institutionName).toBe('Chase');
      expect(result?.plaidConnection?.status).toBe('active');
    });
  });

  describe('POST account', () => {
    it('creates account with required fields', async () => {
      const accountData = {
        name: 'Test Checking',
        type: 'checking',
      };

      const created = await prisma.account.create({ data: accountData });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Test Checking');
      expect(created.type).toBe('checking');
      expect(created.currency).toBe('USD'); // Default
      expect(created.isActive).toBe(true); // Default
    });

    it('creates account with all optional fields', async () => {
      const accountData = {
        name: 'Savings Account',
        type: 'savings',
        institution: 'Bank of America',
        currency: 'EUR',
        isActive: true,
        notes: 'Emergency fund',
      };

      const created = await prisma.account.create({ data: accountData });

      expect(created.name).toBe('Savings Account');
      expect(created.institution).toBe('Bank of America');
      expect(created.currency).toBe('EUR');
      expect(created.notes).toBe('Emergency fund');
    });

    it('creates account with non-USD currency', async () => {
      const created = await prisma.account.create({
        data: {
          name: 'Canadian Account',
          type: 'checking',
          currency: 'CAD',
        },
      });

      expect(created.currency).toBe('CAD');
    });
  });

  describe('PATCH account', () => {
    it('updates account name', async () => {
      const account = createAccountData({ name: 'Old Name' });
      const created = await prisma.account.create({ data: account });

      const updated = await prisma.account.update({
        where: { id: created.id },
        data: { name: 'New Name' },
      });

      expect(updated.name).toBe('New Name');
    });

    it('deactivates account', async () => {
      const account = createAccountData({ isActive: true });
      const created = await prisma.account.create({ data: account });

      const updated = await prisma.account.update({
        where: { id: created.id },
        data: { isActive: false },
      });

      expect(updated.isActive).toBe(false);
    });

    it('updates account notes', async () => {
      const account = createAccountData({});
      const created = await prisma.account.create({ data: account });

      const updated = await prisma.account.update({
        where: { id: created.id },
        data: { notes: 'Updated notes' },
      });

      expect(updated.notes).toBe('Updated notes');
    });
  });

  describe('DELETE account', () => {
    it('deletes account', async () => {
      const account = createAccountData({});
      const created = await prisma.account.create({ data: account });

      await prisma.account.delete({ where: { id: created.id } });

      const found = await prisma.account.findFirst({ where: { id: created.id } });
      expect(found).toBeNull();
    });

    it('deleting transactions allows account deletion', async () => {
      const account = createAccountData({});
      const created = await prisma.account.create({ data: account });

      // Create a transaction linked to the account
      await prisma.transaction.create({
        data: {
          accountId: created.id,
          date: new Date(),
          amount: -50,
          merchant: 'Test Merchant',
          merchantNormalized: 'test merchant',
        },
      });

      // Delete transactions first (no cascade in schema)
      await prisma.transaction.deleteMany({ where: { accountId: created.id } });

      // Now delete the account
      await prisma.account.delete({ where: { id: created.id } });

      // Verify account is deleted
      const found = await prisma.account.findFirst({ where: { id: created.id } });
      expect(found).toBeNull();
    });
  });

  describe('account types', () => {
    it('supports checking account type', async () => {
      const created = await prisma.account.create({
        data: { name: 'Checking', type: 'checking' },
      });
      expect(created.type).toBe('checking');
    });

    it('supports savings account type', async () => {
      const created = await prisma.account.create({
        data: { name: 'Savings', type: 'savings' },
      });
      expect(created.type).toBe('savings');
    });

    it('supports credit account type', async () => {
      const created = await prisma.account.create({
        data: { name: 'Credit Card', type: 'credit' },
      });
      expect(created.type).toBe('credit');
    });

    it('supports investment account type', async () => {
      const created = await prisma.account.create({
        data: { name: 'Brokerage', type: 'investment' },
      });
      expect(created.type).toBe('investment');
    });
  });
});
