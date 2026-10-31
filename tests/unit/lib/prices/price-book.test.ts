import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, seedPrice, seedSecurity } from '../../../helpers/investments';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';
import { PriceSource, Pricing } from '@/lib/investments/codes';

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

  it('gives a security’s latest price from its own mode, up to the requested day', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-01', 10);
    await seedPrice(prisma, s.id, '2026-10-05', 12);
    await seedPrice(prisma, s.id, '2026-10-06', 13);
    await seedPrice(prisma, s.id, '2026-10-04', 99, PriceSource.Institution);
    const book = await PriceBook.load(prisma, [s.id], day('2026-10-05'));
    expect(book.latest(s.id)).toEqual({ price: 12, date: day('2026-10-05') });
    expect(book.latest('missing')).toBeNull();
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

  it("prices a Plaid-priced security through its proxy's closes", async () => {
    const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
    await prisma.security.update({ where: { id: fund.id }, data: { proxySecurityId: proxy.id } });
    await seedPrice(prisma, fund.id, '2026-10-01', 20, PriceSource.Institution);
    await seedPrice(prisma, proxy.id, '2026-09-01', 50);
    await seedPrice(prisma, proxy.id, '2026-10-01', 100);
    const book = await PriceBook.load(prisma, [fund.id], day('2026-10-09'));
    expect(book.at(fund.id, day('2026-09-15'))).toEqual({ price: 10, estimated: true });
    expect(book.at(proxy.id, day('2026-09-15'))).toBeNull(); // only requested securities answer
  });
});
