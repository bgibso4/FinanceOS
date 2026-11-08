import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';

let routePrisma: PrismaClient;
const fill = vi.fn(async () => ({ pairs: ['CAD->USD'], days: 3, failed: [] }));

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return routePrisma;
  },
}));
vi.mock('@/lib/investments/services', () => ({
  getInvestmentServices: async () => ({ fxRates: { fill } }),
}));

describe('exchange rates API', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    routePrisma = prisma;
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('GET returns the latest row per pair', async () => {
    const { GET } = await import('@/app/api/exchange-rates/route');
    await prisma.exchangeRate.createMany({
      data: [
        { fromCurrency: 'CAD', toCurrency: 'USD', date: new Date('2026-11-05'), rate: 0.72 },
        { fromCurrency: 'CAD', toCurrency: 'USD', date: new Date('2026-11-06'), rate: 0.73 },
        { fromCurrency: 'EUR', toCurrency: 'USD', date: new Date('2026-11-04'), rate: 1.08 },
      ],
    });
    const { rates } = await (await GET()).json();
    expect(rates).toHaveLength(2);
    expect(rates[0]).toMatchObject({ fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.73 });
    expect(rates[0].date).toBe('2026-11-06T00:00:00.000Z');
    expect(rates[0].updatedAt).toBeDefined();
    expect(rates[1]).toMatchObject({ fromCurrency: 'EUR', rate: 1.08 });
  });

  it('exchangeRatesIncludesSummary', async () => {
    const { GET } = await import('@/app/api/exchange-rates/route');
    await prisma.exchangeRate.createMany({
      data: [
        { fromCurrency: 'CAD', toCurrency: 'USD', date: new Date('2025-11-05'), rate: 0.7 },
        { fromCurrency: 'CAD', toCurrency: 'USD', date: new Date('2026-10-29'), rate: 0.72 },
        { fromCurrency: 'CAD', toCurrency: 'USD', date: new Date('2026-11-06'), rate: 0.73 },
        { fromCurrency: 'EUR', toCurrency: 'USD', date: new Date('2026-11-04'), rate: 1.08 },
      ],
    });
    const { rates } = await (await GET()).json();
    expect(rates[0]).toMatchObject({
      rate: 0.73,
      yearAgoRate: 0.7,
      weekly: [
        { day: '2026-10-29', rate: 0.72 },
        { day: '2026-11-06', rate: 0.73 },
      ],
      monthEnds: [
        { month: '2026-11', rate: 0.73 },
        { month: '2026-10', rate: 0.72 },
        { month: '2025-11', rate: 0.7 },
      ],
    });
    expect(rates[1]).toMatchObject({ rate: 1.08, yearAgoRate: null });
  });

  it('GET returns an empty list with no rates', async () => {
    const { GET } = await import('@/app/api/exchange-rates/route');
    expect((await (await GET()).json()).rates).toEqual([]);
  });

  it('has no POST or per-id route any more', async () => {
    const route = await import('@/app/api/exchange-rates/route');
    expect('POST' in route).toBe(false);
    const fs = await import('node:fs');
    expect(fs.existsSync('src/app/api/exchange-rates/[id]')).toBe(false);
  });

  it('POST /refresh returns the fill result', async () => {
    const { POST } = await import('@/app/api/exchange-rates/refresh/route');
    const res = await POST();
    expect(await res.json()).toEqual({ pairs: ['CAD->USD'], days: 3, failed: [] });
    expect(fill).toHaveBeenCalledOnce();
  });
});
