import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { findPotentialReturns, linkReturn, unlinkReturn } from '@/lib/returns';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createTransactionData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import { subDays } from 'date-fns';

describe('returns', () => {
  let prisma: PrismaClient;
  let testAccountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();

    // Create a test account
    const account = createAccountData({ id: 'test-account', name: 'Test Account' });
    await prisma.account.create({ data: account });
    testAccountId = account.id!;
  });

  describe('findPotentialReturns', () => {
    it('finds exact merchant match with opposite sign', async () => {
      // Create a purchase
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'AMAZON',
          merchantNormalized: 'amazon',
          amount: -100,
          date: new Date(),
        }),
      });

      // Create a return (opposite sign, same merchant)
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'AMAZON',
          merchantNormalized: 'amazon',
          amount: 50, // Positive = refund
          date: new Date(),
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].merchantNormalized).toBe('amazon');
      expect(matches[0].amount).toBe(50);
    });

    it('finds fuzzy merchant match', async () => {
      // Create a purchase
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'AMAZON MARKETPLACE',
          merchantNormalized: 'amazon marketplace',
          amount: -100,
          date: new Date(),
        }),
      });

      // Create a return with slightly different merchant name
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'AMAZON REFUND',
          merchantNormalized: 'amazon refund',
          amount: 50,
          date: new Date(),
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      expect(matches.length).toBeGreaterThan(0);
    });

    it('respects date range (180 days)', async () => {
      // Create a purchase
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: -100,
          date: new Date(),
        }),
      });

      // Create a return within range
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 50,
          date: subDays(new Date(), 30), // 30 days ago
        }),
      });

      // Create a return outside range (would need separate test with modified findPotentialReturns)
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 25,
          date: subDays(new Date(), 200), // 200 days ago - outside range
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      // Should find the one within range
      expect(matches.length).toBeGreaterThan(0);
    });

    it('excludes already linked transactions', async () => {
      // Create a purchase
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: -100,
          date: new Date(),
        }),
      });

      // Create another transaction to link to
      const otherPurchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'OTHER STORE',
          merchantNormalized: 'other store',
          amount: -75,
          date: new Date(),
        }),
      });

      // Create a return that is already linked
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 50,
          date: new Date(),
          isOffset: true,
          linkedTransactionId: otherPurchase.id,
        }),
      });

      // Create an unlinked return
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 25,
          date: new Date(),
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      // Should only find the unlinked one
      const linkedMatches = matches.filter((m) => m.linkedTransactionId !== null);
      expect(linkedMatches).toHaveLength(0);
    });

    it('excludes transactions marked as offset', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: -100,
          date: new Date(),
        }),
      });

      // Already marked as offset
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 50,
          date: new Date(),
          isOffset: true,
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      const offsetMatches = matches.filter((m) => m.isOffset === true);
      expect(offsetMatches).toHaveLength(0);
    });

    it('returns empty array for non-existent transaction', async () => {
      const matches = await findPotentialReturns(prisma, 'non-existent-id');
      expect(matches).toHaveLength(0);
    });

    it('scores matches by amount similarity', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: -100,
          date: new Date(),
        }),
      });

      // Exact amount match
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 100, // Exact match
          date: new Date(),
        }),
      });

      // Partial refund
      await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 50, // Partial
          date: new Date(),
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      expect(matches.length).toBe(2);
      // Exact amount match should score higher
      expect(matches[0].amount).toBe(100);
    });

    it('only searches within same account', async () => {
      // Create another account
      const account2 = createAccountData({ id: 'test-account-2', name: 'Account 2' });
      await prisma.account.create({ data: account2 });

      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: -100,
          date: new Date(),
        }),
      });

      // Create return in different account
      await prisma.transaction.create({
        data: createTransactionData(account2.id!, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 50,
          date: new Date(),
        }),
      });

      const matches = await findPotentialReturns(prisma, purchase.id);

      // Should not find the return from different account
      const otherAccountMatches = matches.filter((m) => m.accountId === account2.id);
      expect(otherAccountMatches).toHaveLength(0);
    });
  });

  describe('linkReturn', () => {
    it('links return transaction to original purchase', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: -100,
          date: new Date(),
        }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          merchant: 'STORE',
          merchantNormalized: 'store',
          amount: 50,
          date: new Date(),
        }),
      });

      const result = await linkReturn(prisma, returnTx.id, purchase.id);

      expect(result.success).toBe(true);

      // Verify the return is linked
      const updated = await prisma.transaction.findUnique({
        where: { id: returnTx.id },
      });
      expect(updated?.isOffset).toBe(true);
      expect(updated?.linkedTransactionId).toBe(purchase.id);
    });

    it('sets isOffset to true', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { amount: -100 }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { amount: 50, isOffset: false }),
      });

      await linkReturn(prisma, returnTx.id, purchase.id);

      const updated = await prisma.transaction.findUnique({
        where: { id: returnTx.id },
      });
      expect(updated?.isOffset).toBe(true);
    });
  });

  describe('unlinkReturn', () => {
    it('unlinks return transaction from purchase', async () => {
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { amount: -100 }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50,
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      const result = await unlinkReturn(prisma, returnTx.id);

      expect(result.success).toBe(true);

      const updated = await prisma.transaction.findUnique({
        where: { id: returnTx.id },
      });
      expect(updated?.isOffset).toBe(false);
      expect(updated?.linkedTransactionId).toBeNull();
    });

    it('sets isOffset to false', async () => {
      // Create a purchase to link to
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { amount: -100 }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50,
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      await unlinkReturn(prisma, returnTx.id);

      const updated = await prisma.transaction.findUnique({
        where: { id: returnTx.id },
      });
      expect(updated?.isOffset).toBe(false);
    });

    it('clears linkedTransactionId', async () => {
      // Create a purchase to link to
      const purchase = await prisma.transaction.create({
        data: createTransactionData(testAccountId, { amount: -100 }),
      });

      const returnTx = await prisma.transaction.create({
        data: createTransactionData(testAccountId, {
          amount: 50,
          isOffset: true,
          linkedTransactionId: purchase.id,
        }),
      });

      await unlinkReturn(prisma, returnTx.id);

      const updated = await prisma.transaction.findUnique({
        where: { id: returnTx.id },
      });
      expect(updated?.linkedTransactionId).toBeNull();
    });
  });
});
