import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, seedPrice, seedSecurity } from '../../../helpers/investments';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';

describe('PriceBook / loadFxRates', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('answers from stored prices up to the requested day', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-01', 10);
    await seedPrice(prisma, s.id, '2026-10-05', 12);
    const book = await PriceBook.load(prisma, [s.id], day('2026-10-02'));
    expect(book.at(s.id, day('2026-10-09'))).toEqual({ price: 10, estimated: false });
    expect(book.at('missing', day('2026-10-09'))).toBeNull();
  });

  it('loads exchange rates keyed FROM_TO', async () => {
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 },
    });
    expect((await loadFxRates(prisma)).get('CAD_USD')).toBe(0.75);
  });
});
