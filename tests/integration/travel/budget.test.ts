import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData } from '../../helpers/factories';
import { createTravelServices } from '@/lib/travel/services';
import { calculateGoalProgress } from '@/lib/goals';
import { fixedClock } from '@/lib/clock';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { POST as createGoal } from '@/app/api/goals/route';
import { PATCH as patchGoal } from '@/app/api/goals/[id]/route';
import { GET as getTravel } from '@/app/api/travel/route';
import { GET as getBudget, PUT as putBudget } from '@/app/api/travel/budget/route';

const jsonReq = (method: string, body?: unknown, url = 'http://localhost/api/x') =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

describe('TravelBudget', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(teardownTestDb);
  beforeEach(resetTestDb);

  const services = (iso = '2026-06-01T00:00:00Z') =>
    createTravelServices({ prisma: testPrisma, clock: fixedClock(iso) });

  it('setCreatesOneGoalPerYear', async () => {
    const { budget } = services();
    await budget.set(2026, 3000);
    await budget.set(2026, 4000);
    const goals = await testPrisma.goal.findMany();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      name: '2026 Travel Budget',
      type: 'spending',
      trackingMethod: 'travel',
      targetAmount: 4000,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
  });

  it('travelGoalProgressMatchesYearSpent', async () => {
    const { budget, totals } = services();
    const account = await testPrisma.account.create({ data: createAccountData() });
    const travel = await testPrisma.category.create({
      data: createCategoryData({ name: 'Travel' }),
    });
    await testPrisma.transaction.create({
      data: {
        accountId: account.id,
        categoryId: travel.id,
        date: new Date('2026-03-01T00:00:00Z'),
        amount: -250,
        merchant: 'Air',
        merchantNormalized: 'air',
        importHash: 'a',
      },
    });
    await budget.set(2026, 1000);
    const got = await budget.get(2026);
    expect(got).toMatchObject({ target: 1000, spent: 250 });
    expect(got?.spent).toBe(await totals.budgetSpent(2026));
    const goal = await testPrisma.goal.findFirstOrThrow();
    expect((await calculateGoalProgress(goal, testPrisma)).currentAmount).toBe(250);
    expect(await budget.get(2025)).toBeNull();
  });

  it('goalsApiRejectsTravelMethod', async () => {
    const res = await createGoal(
      new NextRequest('http://localhost/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          name: 'x',
          type: 'spending',
          targetAmount: 10,
          trackingMethod: 'travel',
        }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Travel budgets are managed in Travel');

    const g = await testPrisma.goal.create({
      data: { name: 'g', type: 'spending', targetAmount: 5, trackingMethod: 'tag' },
    });
    const patched = await patchGoal(
      new NextRequest('http://localhost/api/goals/x', {
        method: 'PATCH',
        body: JSON.stringify({ trackingMethod: 'travel' }),
      }),
      { params: Promise.resolve({ id: g.id }) }
    );
    expect(patched.status).toBe(400);
  });

  it('statusReportsMissingCurrentYearBudget', async () => {
    const { budget } = services('2027-01-05T00:00:00Z');
    await budget.set(2026, 1000);
    expect(await budget.status()).toEqual({ year: 2027, hasBudget: false });
    await budget.set(2027, 1000);
    expect(await budget.status()).toEqual({ year: 2027, hasBudget: true });
  });

  it('goalsApiLeavesTravelGoalsUnchanged', async () => {
    const { budget } = services();
    await budget.set(2026, 1000);
    const before = await testPrisma.goal.findFirstOrThrow();
    for (const body of [{ trackingMethod: 'tag' }, { name: 'x' }, { startDate: '2025-01-01' }]) {
      const res = await patchGoal(jsonReq('PATCH', body), {
        params: Promise.resolve({ id: before.id }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Travel budgets are managed in Travel');
    }
    expect(await testPrisma.goal.findFirstOrThrow()).toEqual(before);
  });

  it('travelRouteValidatesYearAndReturnsViewWithBudget', async () => {
    for (const y of ['abc', '1.5', '99999']) {
      const res = await getTravel(
        jsonReq('GET', undefined, `http://localhost/api/travel?year=${y}`)
      );
      expect(res.status).toBe(400);
    }
    const none = await (
      await getTravel(jsonReq('GET', undefined, 'http://localhost/api/travel?year=2026'))
    ).json();
    expect(none.view.year).toBe(2026);
    expect(none.budget).toBeNull();
    await services().budget.set(2026, 900);
    const some = await (
      await getTravel(jsonReq('GET', undefined, 'http://localhost/api/travel?year=2026'))
    ).json();
    expect(some.budget).toEqual({ target: 900, spent: 0 });
  });

  it('budgetRouteSavesPositiveAmountsAndReportsStatus', async () => {
    for (const body of [
      { year: 2026, amount: 0 },
      { year: 2026, amount: -5 },
      { year: 2026 },
      { amount: 5 },
    ]) {
      expect((await putBudget(jsonReq('PUT', body))).status).toBe(400);
    }
    expect(await testPrisma.goal.count()).toBe(0);
    const ok = await putBudget(jsonReq('PUT', { year: 2026, amount: 1200 }));
    expect(await ok.json()).toEqual({ success: true });
    expect((await testPrisma.goal.findFirstOrThrow()).targetAmount).toBe(1200);
    const status = await (await getBudget()).json();
    expect(status.year).toBe(new Date().getUTCFullYear());
    expect(typeof status.hasBudget).toBe('boolean');
  });
});
