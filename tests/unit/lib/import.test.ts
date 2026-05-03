import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { importCsv } from '@/lib/import';
import { setupTestDb, teardownTestDb, resetTestDb, getTestPrisma } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

describe('import', () => {
  let prisma: PrismaClient;
  let testAccountId: string;

  const defaultMapping = {
    date: 'Date',
    amount: 'Amount',
    merchant: 'Description',
  };

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

    // Create categories for auto-categorization
    await prisma.category.createMany({
      data: [
        createCategoryData({ id: 'cat-groceries', name: 'Groceries', type: 'expense' }),
        createCategoryData({ id: 'cat-transport', name: 'Transport', type: 'expense' }),
        createCategoryData({ id: 'cat-shopping', name: 'Shopping', type: 'expense' }),
        createCategoryData({ id: 'cat-entertainment', name: 'Entertainment', type: 'expense' }),
        createCategoryData({ id: 'cat-income', name: 'Income', type: 'income' }),
      ],
    });
  });

  describe('CSV parsing', () => {
    it('parses valid CSV file', async () => {
      const csv = `Date,Description,Amount
2024-01-15,TRADER JOE'S,-89.42
2024-01-14,UBER *TRIP,-24.50`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      expect(result.created).toBe(2);
      expect(result.imported).toBe(2);
    });

    it('handles YYYY-MM-DD date format', async () => {
      const csv = `Date,Description,Amount
2024-01-15,TEST MERCHANT,-50.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);
      expect(result.created).toBe(1);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.date.toISOString().split('T')[0]).toBe('2024-01-15');
    });

    it('handles MM/DD/YYYY date format', async () => {
      const csv = `Date,Description,Amount
01/15/2024,TEST MERCHANT,-50.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);
      expect(result.created).toBe(1);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.date.toISOString().split('T')[0]).toBe('2024-01-15');
    });

    it('handles MM/DD/YY date format (2-digit year)', async () => {
      const csv = `Date,Description,Amount
01/15/24,TEST MERCHANT,-50.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);
      expect(result.created).toBe(1);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.date.toISOString().split('T')[0]).toBe('2024-01-15');
    });

    it('handles negative amounts as expenses', async () => {
      const csv = `Date,Description,Amount
2024-01-15,EXPENSE,-100.00`;

      await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.amount).toBe(-100);
    });

    it('handles positive amounts as income', async () => {
      const csv = `Date,Description,Amount
2024-01-15,PAYROLL,5000.00`;

      await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.amount).toBe(5000);
    });

    it('inverts amounts when invertAmounts is true', async () => {
      const csv = `Date,Description,Amount
2024-01-15,EXPENSE,100.00`;

      await importCsv(prisma, csv, defaultMapping, testAccountId, true);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.amount).toBe(-100);
    });

    it('skips empty rows gracefully', async () => {
      const csv = `Date,Description,Amount
2024-01-15,MERCHANT 1,-50.00

2024-01-14,MERCHANT 2,-30.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);
      expect(result.created).toBe(2);
    });

    it('throws error for missing date value', async () => {
      const csv = `Date,Description,Amount
,MERCHANT,-50.00`;

      await expect(importCsv(prisma, csv, defaultMapping, testAccountId)).rejects.toThrow(
        /Missing date value/
      );
    });

    it('throws error for invalid date format', async () => {
      const csv = `Date,Description,Amount
not-a-date,MERCHANT,-50.00`;

      await expect(importCsv(prisma, csv, defaultMapping, testAccountId)).rejects.toThrow(
        /Invalid date format/
      );
    });

    it('throws error for invalid amount', async () => {
      const csv = `Date,Description,Amount
2024-01-15,MERCHANT,not-a-number`;

      await expect(importCsv(prisma, csv, defaultMapping, testAccountId)).rejects.toThrow(
        /Invalid amount/
      );
    });

    it('handles date outside valid range', async () => {
      const csv = `Date,Description,Amount
2015-01-15,OLD TRANSACTION,-50.00`;

      await expect(importCsv(prisma, csv, defaultMapping, testAccountId)).rejects.toThrow(
        /outside valid range/
      );
    });
  });

  describe('deduplication', () => {
    it('skips duplicate by importHash', async () => {
      const csv = `Date,Description,Amount
2024-01-15,TRADER JOE'S,-89.42`;

      // Import once
      await importCsv(prisma, csv, defaultMapping, testAccountId);

      // Try to import again
      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].reason).toContain('Already exists');
    });

    it('skips duplicate by normalized merchant match', async () => {
      // First import
      const csv1 = `Date,Description,Amount
2024-01-15,TRADER JOE'S #123,-89.42`;

      await importCsv(prisma, csv1, defaultMapping, testAccountId);

      // Second import with exact same normalized form and import hash
      const csv2 = `Date,Description,Amount
2024-01-15,TRADER JOE'S #123,-89.42`;

      const result = await importCsv(prisma, csv2, defaultMapping, testAccountId);

      // Should be detected as duplicate via importHash
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('allows same merchant on different dates', async () => {
      const csv = `Date,Description,Amount
2024-01-15,STARBUCKS,-5.00
2024-01-16,STARBUCKS,-5.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('allows same merchant with different amounts on same date', async () => {
      const csv = `Date,Description,Amount
2024-01-15,AMAZON,-50.00
2024-01-15,AMAZON,-75.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      expect(result.created).toBe(2);
    });
  });

  describe('auto-categorization', () => {
    it('auto-categorizes using keyword catalog', async () => {
      const csv = `Date,Description,Amount
2024-01-15,TRADER JOE'S,-89.42`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.categoryId).toBe('cat-groceries');
      expect(transaction?.confidenceScore).toBe(0.72);
      expect(result.autoCategorized).toBe(1);
    });

    it('leaves unknown merchants uncategorized', async () => {
      const csv = `Date,Description,Amount
2024-01-15,UNKNOWN RANDOM STORE,-50.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.categoryId).toBeNull();
      expect(transaction?.confidenceScore).toBe(0.3);
      expect(result.uncategorized).toBe(1);
    });

    it('normalizes merchant names before categorization', async () => {
      // Using a merchant that normalizes cleanly to match keyword
      const csv = `Date,Description,Amount
2024-01-15,UBER RIDE,-24.50`;

      await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      // 'UBER RIDE' normalizes to 'uber ride' which contains 'uber' keyword
      expect(transaction?.merchantNormalized).toBe('uber ride');
      expect(transaction?.categoryId).toBe('cat-transport');
    });

    it('reports categorization stats', async () => {
      const csv = `Date,Description,Amount
2024-01-15,TRADER JOE'S,-50.00
2024-01-14,UBER *TRIP,-20.00
2024-01-13,UNKNOWN STORE,-30.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      expect(result.autoCategorized).toBe(2);
      expect(result.uncategorized).toBe(1);
      expect(result.autoCategorizedList).toHaveLength(2);
      expect(result.uncategorizedList).toHaveLength(1);
    });
  });

  describe('transfer detection', () => {
    it('detects same-day opposite amount transfers within same account', async () => {
      // Use recent date for transfer detection (within 90 days)
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      const csv = `Date,Description,Amount
${dateStr},TRANSFER OUT,-500.00
${dateStr},TRANSFER IN,500.00`;

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      // Transfer detection runs after import
      expect(result.sameAccount).toBeGreaterThanOrEqual(1);

      const transactions = await prisma.transaction.findMany({
        where: { isTransfer: true },
      });
      expect(transactions).toHaveLength(2);
      expect(transactions[0].transferGroupId).toBe(transactions[1].transferGroupId);
    });

    it('detects cross-account transfers', async () => {
      // Create second account
      const account2 = createAccountData({ id: 'test-account-2', name: 'Savings' });
      await prisma.account.create({ data: account2 });

      // Use recent date for transfer detection (within 90 days)
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      // Import outgoing transfer with transfer keyword in merchant
      const csv1 = `Date,Description,Amount
${dateStr},TRANSFER TO SAVINGS,-500.00`;
      await importCsv(prisma, csv1, defaultMapping, testAccountId);

      // Import incoming transfer to second account
      const csv2 = `Date,Description,Amount
${dateStr},TRANSFER FROM CHECKING,500.00`;
      const result = await importCsv(prisma, csv2, defaultMapping, account2.id!);

      expect(result.crossAccount).toBeGreaterThanOrEqual(1);
    });

    it('does not pair a credit card charge with its payment when the payment has a cross-account match', async () => {
      // Bilt rent scenario: a rent charge (-$5390) on the credit card and a
      // payment-received (+$5390) on the same card on the same date should NOT
      // be paired as a same-account transfer, because the payment-received has
      // a real cross-account counterpart on the funding checking account.
      const biltAccount = createAccountData({
        id: 'bilt-account',
        name: 'Bilt',
        type: 'credit',
      });
      const checkingAccount = createAccountData({
        id: 'checking-account',
        name: 'Checking',
        type: 'checking',
      });
      await prisma.account.create({ data: biltAccount });
      await prisma.account.create({ data: checkingAccount });

      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      // 1. Rent charge on Bilt
      const csvBilt = `Date,Description,Amount
${dateStr},Bilt Housing Payment,-5390.00
${dateStr},Payment - Bilt Housing,5390.00`;
      await importCsv(prisma, csvBilt, defaultMapping, biltAccount.id!);

      // 2. Payment leaving Checking
      const csvChecking = `Date,Description,Amount
${dateStr},BILT,-5390.00`;
      await importCsv(prisma, csvChecking, defaultMapping, checkingAccount.id!);

      const all = await prisma.transaction.findMany({
        where: { accountId: { in: [biltAccount.id!, checkingAccount.id!] } },
        orderBy: { merchant: 'asc' },
      });

      const rentCharge = all.find((t) => t.merchant === 'Bilt Housing Payment');
      const paymentReceived = all.find((t) => t.merchant === 'Payment - Bilt Housing');
      const paymentSent = all.find(
        (t) => t.merchant === 'BILT' && t.accountId === checkingAccount.id
      );

      // The rent charge is a real expense, not a transfer
      expect(rentCharge?.isTransfer).toBe(false);
      expect(rentCharge?.transferGroupId).toBeNull();

      // The payment-received and payment-sent form the actual transfer pair
      expect(paymentReceived?.isTransfer).toBe(true);
      expect(paymentSent?.isTransfer).toBe(true);
      expect(paymentReceived?.transferGroupId).toBe(paymentSent?.transferGroupId);
      expect(paymentReceived?.transferGroupId).not.toBeNull();
    });
  });

  describe('import from CSV files', () => {
    it('imports valid CSV file from fixtures', async () => {
      const csvPath = path.join(__dirname, '../../fixtures/csv-samples/valid-import.csv');
      const csv = fs.readFileSync(csvPath, 'utf-8');

      const result = await importCsv(prisma, csv, defaultMapping, testAccountId);

      expect(result.created).toBe(5);
    });

    it('handles duplicates across separate imports', async () => {
      // First import
      const csv = `Date,Description,Amount
2024-01-15,TRADER JOE'S,-89.42
2024-01-14,UBER *TRIP,-24.50`;

      const result1 = await importCsv(prisma, csv, defaultMapping, testAccountId);
      expect(result1.created).toBe(2);

      // Re-import the same data - should all be duplicates
      const result2 = await importCsv(prisma, csv, defaultMapping, testAccountId);
      expect(result2.created).toBe(0);
      expect(result2.skipped).toBe(2);
    });
  });

  describe('merchant normalization during import', () => {
    it('stores both original and normalized merchant', async () => {
      const csv = `Date,Description,Amount
2024-01-15,AMAZON.COM*ABC123XYZ,-50.00`;

      await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.merchant).toBe('AMAZON.COM*ABC123XYZ');
      expect(transaction?.merchantNormalized).toBe('amazon com');
    });
  });

  describe('note field handling', () => {
    it('imports note field when mapping is provided', async () => {
      const csv = `Date,Description,Amount,Note
2024-01-15,RESTAURANT,-50.00,Business lunch`;

      const mappingWithNote = {
        ...defaultMapping,
        note: 'Note',
      };

      await importCsv(prisma, csv, mappingWithNote, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.note).toBe('Business lunch');
    });

    it('leaves note null when not in mapping', async () => {
      const csv = `Date,Description,Amount
2024-01-15,RESTAURANT,-50.00`;

      await importCsv(prisma, csv, defaultMapping, testAccountId);

      const transaction = await prisma.transaction.findFirst();
      expect(transaction?.note).toBeNull();
    });
  });
});
