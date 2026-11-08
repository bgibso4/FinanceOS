import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createPriceIndexServices } from '@/lib/price-index/services';
import type { PriceIndexSource } from '@/lib/price-index/types';

let services: ReturnType<typeof createPriceIndexServices>;
const fetchMonths = vi.fn(async () => []);

vi.mock('@/lib/price-index/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/price-index/services')>()),
  getPriceIndexServices: async () => services,
}));

const source = (region: 'US' | 'CA', attribution: string): PriceIndexSource => ({
  region,
  attribution,
  fetchMonths,
});

describe('GET /api/price-index', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    services = createPriceIndexServices({
      prisma,
      sources: [source('US', 'US attribution'), source('CA', 'CA attribution')],
    });
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    fetchMonths.mockClear();
  });

  it('priceIndexReturnsBothRegionsAndSelected', async () => {
    const { GET } = await import('@/app/api/price-index/route');
    await prisma.userSettings.create({ data: { inflationRegion: 'CA' } });
    await services.store.save('US', [
      { month: '2026-09', value: 312 },
      { month: '2026-08', value: 311 },
    ]);
    await services.store.save('CA', [{ month: '2026-09', value: 160 }]);

    const body = await (await GET()).json();

    expect(body.selected).toBe('CA');
    expect(body.regions.map((r: { region: string }) => r.region)).toEqual(['US', 'CA']);
    const [us, ca] = body.regions;
    expect(us).toMatchObject({ name: 'US', attribution: 'US attribution' });
    expect(us.months).toEqual([
      { month: '2026-08', value: 311 },
      { month: '2026-09', value: 312 },
    ]);
    expect(typeof us.fetchedAt).toBe('string');
    expect(ca).toMatchObject({ name: 'Canada', attribution: 'CA attribution' });
    expect(fetchMonths).not.toHaveBeenCalled();
  });

  it('priceIndexFallsBackToUsForUnknownStoredRegion', async () => {
    const { GET } = await import('@/app/api/price-index/route');
    await prisma.userSettings.create({ data: { inflationRegion: 'XX' } });
    expect((await (await GET()).json()).selected).toBe('US');
  });

  it('priceIndexEmptyBeforeFetch', async () => {
    const { GET } = await import('@/app/api/price-index/route');
    const body = await (await GET()).json();
    expect(body.selected).toBe('US');
    for (const region of body.regions) {
      expect(region.months).toEqual([]);
      expect(region.fetchedAt).toBeNull();
    }
  });
});
