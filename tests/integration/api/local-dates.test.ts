import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import { freezeClock, inNewYork, NEW_YORK_EVENING } from '../../helpers/time-zone';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { dashboardAnalytics, monthlySnapshot } from '@/lib/analytics';
import { POST as closeMonth } from '@/app/api/reports/close-month/route';
import { POST as createRecurring } from '@/app/api/recurring/route';
import { POST as adjust } from '@/app/api/transactions/adjustment/route';

const ACCOUNT = 'test-account';
const post = (body: unknown) =>
  new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });

let seq = 0;
const tx = (date: string, amount: number, merchant = 'Test Merchant') =>
  testPrisma.transaction.create({
    data: {
      date: new Date(`${date}T00:00:00.000Z`),
      amount,
      merchant,
      merchantNormalized: merchant.toLowerCase(),
      accountId: ACCOUNT,
      importHash: `test-hash-${++seq}`,
    },
  });

describe('dates across the app, in New York', () => {
  inNewYork();

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    await testPrisma.account.create({
      data: createAccountData({ id: ACCOUNT, name: 'Test Account' }),
    });
  });

  describe('month boundaries', () => {
    beforeEach(async () => {
      await tx('2026-10-31', -1);
      await tx('2026-11-01', 1000);
      await tx('2026-11-30', -500);
      await tx('2026-12-01', 9000);
    });

    it('a monthly snapshot counts the 1st and leaves out the next month’s 1st', async () => {
      const snapshot = await monthlySnapshot(testPrisma, '2026-11');
      expect(snapshot.incomeTotal).toBe(1000);
      expect(snapshot.spendingTotal).toBe(500);
    });

    it('the rolling savings rate counts the 1st of the month', async () => {
      const result = await dashboardAnalytics(
        testPrisma,
        {},
        new Date('2026-11-01T00:00:00.000Z'),
        new Date('2026-11-30T23:59:59.999Z')
      );
      expect(result.savingsRate.rollingAvg).toBeCloseTo(0.5 / 3);
    });
  });

  describe('late in the evening', () => {
    beforeEach(() => freezeClock(NEW_YORK_EVENING));

    it('closing a month defaults to the local month at a month’s end', async () => {
      freezeClock('2026-12-01T03:30:00.000Z'); // Nov 30, 10:30pm in New York
      const res = await closeMonth(post({}));
      expect((await res.json()).month).toBe('2026-11');
    });

    it('a balance adjustment lands on the local day, at UTC midnight', async () => {
      const res = await adjust(post({ accountId: ACCOUNT, amount: 25 }));
      expect(res.status).toBe(200);
      const saved = await testPrisma.transaction.findFirstOrThrow({
        where: { merchant: 'Balance Adjustment' },
      });
      expect(saved.date.toISOString()).toBe('2026-11-06T00:00:00.000Z');
    });

    it('a new recurring item is dated the local day', async () => {
      const res = await createRecurring(
        post({
          merchantDisplay: 'Test Subscription',
          accountId: ACCOUNT,
          frequency: 'monthly',
          expectedAmount: -10,
        })
      );
      expect(res.status).toBe(200);
      const saved = await testPrisma.recurringTransaction.findFirstOrThrow();
      expect(saved.firstSeenDate.toISOString()).toBe('2026-11-06T00:00:00.000Z');
      expect(JSON.parse(saved.priceHistory as string)[0].date).toBe('2026-11-06');
    });
  });
});
