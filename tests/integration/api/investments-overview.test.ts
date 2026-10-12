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
import { GET } from '@/app/api/investments/overview/route';

const get = (query = '') =>
  GET(new NextRequest(`http://localhost/api/investments/overview${query}`));

describe('GET /api/investments/overview', () => {
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

  it('defaults to 3M and returns the overview', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    await seedBalance(testPrisma, a.id, '2026-10-01', 10, 'manual');
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ range: '3M', accounts: [{ id: a.id, value: 10 }] });
  });

  it('accepts a range and rejects an unknown one', async () => {
    expect((await (await get('?range=YTD')).json()).range).toBe('YTD');
    const bad = await get('?range=5Y');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid range' });
  });
});
