import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { GET } from '@/app/api/travel/not-on-trip/route';
import { GET as getYear } from '@/app/api/travel/route';

const call = (handler: typeof GET, year: string) =>
  handler(new NextRequest(`http://localhost/api/travel/not-on-trip?year=${year}`));

describe('GET /api/travel/not-on-trip', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(teardownTestDb);
  beforeEach(resetTestDb);

  it('returnsTheRowsBehindNotOnTrip', async () => {
    await testPrisma.userSettings.create({ data: { baseCurrency: 'USD' } });
    const account = await testPrisma.account.create({ data: createAccountData() });
    const travel = await testPrisma.category.create({
      data: createCategoryData({ name: 'Travel' }),
    });
    const tx = (date: string, amount: number) =>
      testPrisma.transaction.create({
        data: {
          date: new Date(`${date}T12:00:00.000Z`),
          amount,
          merchant: 'Test M',
          accountId: account.id,
          categoryId: travel.id,
        },
      });
    await tx('2026-04-01', -120);
    await tx('2026-05-01', -30.5);
    await tx('2025-05-01', -999);

    const res = await call(GET, '2026');
    expect(res.status).toBe(200);
    const { transactions } = await res.json();
    const year = await (
      await getYear(new NextRequest('http://localhost/api/travel?year=2026'))
    ).json();
    expect(transactions).toHaveLength(year.view.notOnTrip.count);
    expect(-transactions.reduce((n: number, t: { amount: number }) => n + t.amount, 0)).toBe(
      year.view.notOnTrip.spend
    );
    expect(transactions[0].category.name).toBe('Travel');
  });

  it('rejectsABadYear', async () => {
    expect((await call(GET, 'abc')).status).toBe(400);
  });
});
