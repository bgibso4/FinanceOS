import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { spendingByDay, spendingByTag } from '@/lib/analytics';
import { GET as getTags } from '@/app/api/tags/route';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const FAR_FUTURE = new Date(Date.UTC(9999, 0, 1));
const tagged = (...names: string[]) => JSON.stringify(names);

describe('all-time spend per tag', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    await testPrisma.userSettings.create({ data: { baseCurrency: 'USD' } });
    await testPrisma.exchangeRate.create({
      data: {
        fromCurrency: 'CAD',
        toCurrency: 'USD',
        date: new Date('2026-01-01T00:00:00.000Z'),
        rate: 0.75,
      },
    });
    await testPrisma.account.create({ data: createAccountData({ id: 'usd', currency: 'USD' }) });
    await testPrisma.account.create({ data: createAccountData({ id: 'cad', currency: 'CAD' }) });
  });

  it('totalsMatchSpendingByDay', async () => {
    const groceries = (
      await testPrisma.category.create({
        data: createCategoryData({ name: 'Groceries', type: 'expense' }),
      })
    ).id;
    const purchase = createTransactionData('usd', {
      date: day('2026-03-10'),
      amount: -60,
      categoryId: groceries,
      tags: tagged('Green Card'),
    });
    await testPrisma.transaction.createMany({
      data: [
        purchase,
        createTransactionData('usd', {
          date: day('2026-04-05'),
          amount: 20,
          categoryId: groceries,
          isOffset: true,
          linkedTransactionId: purchase.id!,
          tags: tagged('Green Card'),
        }),
        createTransactionData('usd', {
          date: day('2026-02-01'),
          amount: -25.55,
          tags: tagged('Green Card', 'Trip'),
        }),
        createTransactionData('cad', {
          date: day('2026-05-02'),
          amount: -40,
          categoryId: groceries,
          tags: tagged('Trip'),
        }),
        createTransactionData('usd', {
          date: day('2026-06-01'),
          amount: -500,
          isTransfer: true,
          tags: tagged('Trip'),
        }),
      ],
    });

    const map = await spendingByTag(testPrisma);
    expect([...map.keys()].sort()).toEqual(['Green Card', 'Trip']);
    for (const name of ['Green Card', 'Trip']) {
      const rows = await spendingByDay(testPrisma, { tags: [name] }, new Date(0), FAR_FUTURE);
      const spend = map.get(name)!;
      expect(spend.total).toBeCloseTo(
        rows.reduce((acc, r) => acc + r.amount, 0),
        6
      );
      expect(spend.firstDate).toBe(rows[0].date);
      expect(spend.lastDate).toBe(rows[rows.length - 1].date);
    }
    expect(map.get('Trip')!.lastDate).toBe('2026-05-02');
  });

  it('allTransferTagHasZeroAndNoDates', async () => {
    await testPrisma.transaction.create({
      data: createTransactionData('usd', {
        date: day('2026-06-01'),
        amount: -500,
        isTransfer: true,
        tags: tagged('Moves'),
      }),
    });
    const map = await spendingByTag(testPrisma);
    const spend = map.get('Moves') ?? { total: 0, firstDate: null, lastDate: null };
    expect(spend).toEqual({ total: 0, firstDate: null, lastDate: null });
    expect(Object.is(spend.total, -0)).toBe(false);
  });

  it('incomeOnlyTagHasZeroAndNoDates', async () => {
    const salary = (
      await testPrisma.category.create({
        data: createCategoryData({ name: 'Salary', type: 'income' }),
      })
    ).id;
    await testPrisma.transaction.create({
      data: createTransactionData('usd', {
        date: day('2026-06-01'),
        amount: 900,
        categoryId: salary,
        tags: tagged('Pay'),
      }),
    });
    const map = await spendingByTag(testPrisma);
    expect(map.get('Pay') ?? { total: 0, firstDate: null, lastDate: null }).toEqual({
      total: 0,
      firstDate: null,
      lastDate: null,
    });
  });

  it('duplicateTagInOneRowCountsOnce', async () => {
    await testPrisma.transaction.create({
      data: createTransactionData('usd', {
        date: day('2026-03-10'),
        amount: -30,
        tags: tagged('A', 'A'),
      }),
    });
    const map = await spendingByTag(testPrisma);
    const rows = await spendingByDay(testPrisma, { tags: ['A'] }, new Date(0), FAR_FUTURE);
    expect(map.get('A')!.total).toBe(30);
    expect(map.get('A')!.total).toBeCloseTo(
      rows.reduce((acc, r) => acc + r.amount, 0),
      6
    );
    const res = await getTags(new NextRequest('http://x/api/tags?withCounts=true'));
    expect(res.status).toBe(200);
  });

  it('malformedTagsDoNotThrow', async () => {
    await testPrisma.transaction.createMany({
      data: [
        createTransactionData('usd', { date: day('2026-03-10'), amount: -30, tags: '{oops' }),
        createTransactionData('usd', { date: day('2026-03-11'), amount: -5, tags: tagged('B') }),
      ],
    });
    const map = await spendingByTag(testPrisma);
    expect(map.get('B')!.total).toBe(5);
    const res = await getTags(new NextRequest('http://x/api/tags?withCounts=true'));
    expect(res.status).toBe(200);
  });

  it('routeReturnsTotals', async () => {
    await testPrisma.tag.createMany({
      data: [
        { name: 'Trip', color: 'blue' },
        { name: 'Empty', color: 'red' },
      ],
    });
    await testPrisma.transaction.create({
      data: createTransactionData('usd', {
        date: day('2026-02-01'),
        amount: -25.5,
        tags: tagged('Trip'),
      }),
    });
    const res = await getTags(new NextRequest('http://x/api/tags?withCounts=true'));
    const { tags } = await res.json();
    const byName = Object.fromEntries(tags.map((t: { name: string }) => [t.name, t]));
    expect(byName.Trip).toMatchObject({
      transactionCount: 1,
      total: 25.5,
      firstDate: '2026-02-01',
      lastDate: '2026-02-01',
    });
    expect(byName.Empty).toMatchObject({ total: 0, firstDate: null, lastDate: null });
  });
});
