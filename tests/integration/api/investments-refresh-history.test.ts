import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { seedBalance, seedInvestmentAccount, testServices } from '../../helpers/investments';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/investments/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/investments/services')>()),
  getInvestmentServices: vi.fn(),
}));

import { getInvestmentServices } from '@/lib/investments/services';
import { POST as refresh } from '@/app/api/investments/refresh/route';
import { GET as history } from '@/app/api/investments/history/route';

const get = (query: string) =>
  history(new NextRequest(`http://localhost/api/investments/history?${query}`));

describe('investments refresh and history APIs', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(getInvestmentServices).mockResolvedValue(testServices(testPrisma).services);
  });

  it('POST /refresh runs and reports pricesAsOf', async () => {
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stopped: false, pricesAsOf: null });
  });

  it('GET /history returns an account series in its currency', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    await seedBalance(testPrisma, a.id, '2026-10-01', 10, 'manual');
    const res = await get(`accountId=${a.id}&from=2026-10-01&to=2026-10-02`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      currency: 'USD',
      points: [
        { date: '2026-10-01', value: 10, isEstimated: false },
        { date: '2026-10-02', value: 10, isEstimated: true },
      ],
    });
  });

  it('GET /history without accountId returns the portfolio in the base currency', async () => {
    const res = await get('from=2026-10-01&to=2026-10-02');
    expect(await res.json()).toEqual({ currency: 'USD', points: [] });
  });

  it('GET /history validates input', async () => {
    expect((await get('from=2026-13-01')).status).toBe(400);
    expect((await get('from=2026-02-31')).status).toBe(400);
    expect((await get('from=2026-10-05&to=2026-10-01')).status).toBe(400);
    expect((await get('accountId=missing')).status).toBe(404);
    const cash = await testPrisma.account.create({
      data: { name: 'Checking', type: 'checking', currency: 'USD' },
    });
    expect((await get(`accountId=${cash.id}`)).status).toBe(400);
  });
});
