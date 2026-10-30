import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, fakeProvider, seedPrice, seedSecurity } from '../../../helpers/investments';
import { QuoteCache } from '@/lib/prices/quote-cache';
import { SecurityCatalog } from '@/lib/prices/securities';
import type { PriceProvider } from '@/lib/prices/types';
import { PriceSource, Pricing } from '@/lib/investments/codes';

let prisma: PrismaClient;
const catalogFor = (provider: PriceProvider) =>
  new SecurityCatalog(prisma, provider, new QuoteCache(provider));

describe('SecurityCatalog.findOrCreateMarket', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('reuses an existing security with the same price symbol', async () => {
    const existing = await seedSecurity(prisma, { priceSymbol: 'VTI' });
    const { provider } = fakeProvider();
    const r = await catalogFor(provider).findOrCreateMarket('vti');
    expect(r).toMatchObject({ created: false, security: { id: existing.id } });
    expect(provider.getQuote).not.toHaveBeenCalled();
  });

  it('creates a market security from quote and search', async () => {
    const { provider } = fakeProvider({
      closes: { 'TEQ.TO': { '2026-10-09': 30 } },
      currencies: { 'TEQ.TO': 'CAD' },
      search: {
        'TEQ.TO': [{ symbol: 'TEQ.TO', name: 'Test Equity ETF', type: 'etf', exchange: 'TOR' }],
      },
    });
    const { security, created } = await catalogFor(provider).findOrCreateMarket('teq.to');
    expect(created).toBe(true);
    expect(security).toMatchObject({
      ticker: 'TEQ',
      name: 'Test Equity ETF',
      type: 'etf',
      currency: 'CAD',
      priceSymbol: 'TEQ.TO',
      pricing: Pricing.Market,
      priceSymbolOverride: true,
    });
  });

  it('throws for an unknown symbol', async () => {
    const { provider } = fakeProvider();
    await expect(catalogFor(provider).findOrCreateMarket('NOPE')).rejects.toMatchObject({
      kind: 'unknown_symbol',
    });
  });
});

describe('SecurityCatalog.findOrCreateCash', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('creates a fixed-price cash security without calling the provider', async () => {
    const { provider } = fakeProvider();
    const security = await catalogFor(provider).findOrCreateCash('CAD');
    expect(security).toMatchObject({
      name: 'CAD cash',
      ticker: null,
      type: 'cash',
      currency: 'CAD',
      priceSymbol: null,
      priceSymbolOverride: true,
      pricing: Pricing.Fixed,
      fixedPrice: 1,
      plaidSecurityId: null,
    });
    expect(provider.getQuote).not.toHaveBeenCalled();
    expect(provider.getDailyHistory).not.toHaveBeenCalled();
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('reuses an existing fixed-price cash security of the same currency', async () => {
    const plaidCash = await prisma.security.create({
      data: {
        name: 'Test money market',
        type: 'cash',
        currency: 'USD',
        pricing: Pricing.Fixed,
        fixedPrice: 1,
        plaidSecurityId: 'plaid-test-cash',
      },
    });
    const { provider } = fakeProvider();
    const catalog = catalogFor(provider);
    expect((await catalog.findOrCreateCash('USD')).id).toBe(plaidCash.id);
    expect(await prisma.security.count()).toBe(1);
  });

  it("does not reuse another currency's cash", async () => {
    const usd = await seedSecurity(prisma, {
      type: 'cash',
      currency: 'USD',
      priceSymbol: null,
      pricing: Pricing.Fixed,
      fixedPrice: 1,
    });
    const { provider } = fakeProvider();
    const cad = await catalogFor(provider).findOrCreateCash('CAD');
    expect(cad.id).not.toBe(usd.id);
    expect(cad.currency).toBe('CAD');
  });

  it('normalises the currency code', async () => {
    const { provider } = fakeProvider();
    const catalog = catalogFor(provider);
    const first = await catalog.findOrCreateCash(' cad ');
    expect(first).toMatchObject({ currency: 'CAD', name: 'CAD cash' });
    expect((await catalog.findOrCreateCash('CAD')).id).toBe(first.id);
  });

  it('rejects an invalid currency', async () => {
    const { provider } = fakeProvider();
    await expect(catalogFor(provider).findOrCreateCash('XYZ')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('SecurityCatalog.setPriceSymbol', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('clears pricesFetchedFrom so the new symbol gets its full history, and any proxy', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'OLD' });
    const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
    await prisma.security.update({
      where: { id: s.id },
      data: { pricesFetchedFrom: day('2024-10-01'), proxySecurityId: proxy.id },
    });
    const { provider } = fakeProvider({ closes: { NEW: { '2026-10-09': 2 } } });
    const updated = await catalogFor(provider).setPriceSymbol(s.id, 'NEW');
    expect(updated.pricesFetchedFrom).toBeNull();
    expect(updated.proxySecurityId).toBeNull();
  });
});

describe('SecurityCatalog.setProxy', () => {
  const folw = { closes: { FOLW: { '2026-10-09': 60 } } };
  const seedEvent = (securityId: string, source: string) =>
    prisma.securityEvent.create({
      data: { securityId, date: day('2026-09-01'), type: 'dividend', amount: 1, source },
    });
  /** A market-priced security that also holds a stored institution price (switched by mistake). */
  const seedSwitched = async (priceSymbol = 'AAA') => {
    const s = await seedSecurity(prisma, { priceSymbol, pricing: Pricing.Market });
    await seedPrice(prisma, s.id, '2026-10-01', 10, PriceSource.Market);
    await seedPrice(prisma, s.id, '2026-10-02', 11, PriceSource.Institution);
    await seedEvent(s.id, PriceSource.Market);
    return s;
  };
  const sources = async (id: string) => ({
    prices: (await prisma.securityPrice.findMany({ where: { securityId: id } })).map(
      (p) => p.source
    ),
    events: await prisma.securityEvent.count({ where: { securityId: id } }),
  });

  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('switches a market security with institution prices back, following a fund', async () => {
    const s = await seedSwitched();
    const { security: updated } = await catalogFor(fakeProvider(folw).provider).setProxy(
      s.id,
      'FOLW'
    );
    const proxy = await prisma.security.findFirstOrThrow({ where: { priceSymbol: 'FOLW' } });
    expect(updated).toMatchObject({
      pricing: Pricing.Institution,
      priceSymbol: null,
      priceSymbolOverride: true,
      pricesFetchedFrom: null,
      proxySecurityId: proxy.id,
    });
    expect(await sources(s.id)).toEqual({ prices: [PriceSource.Institution], events: 0 });
  });

  it('switches back while following the ticker it was mistakenly priced under', async () => {
    const s = await seedSwitched('FOLW');
    const { security, followed } = await catalogFor(fakeProvider(folw).provider).setProxy(
      s.id,
      'FOLW'
    );
    const proxy = await prisma.security.findFirstOrThrow({
      where: { priceSymbol: 'FOLW', id: { not: s.id } },
    });
    expect(security).toMatchObject({
      pricing: Pricing.Institution,
      priceSymbol: null,
      proxySecurityId: proxy.id,
    });
    expect(proxy.pricing).toBe(Pricing.Market);
    expect(followed).toEqual([proxy.id]);
  });

  it('switches back to follow another security already priced under the same ticker', async () => {
    const s = await seedSwitched('FOLW');
    const other = await seedSecurity(prisma, { priceSymbol: 'FOLW' });
    const { provider } = fakeProvider(folw);
    const { security } = await catalogFor(provider).setProxy(s.id, 'FOLW');
    expect(security).toMatchObject({ pricing: Pricing.Institution, proxySecurityId: other.id });
    expect(await prisma.security.count({ where: { priceSymbol: 'FOLW' } })).toBe(1);
    expect(provider.getQuote).not.toHaveBeenCalled();
  });

  it("re-points the switched security's followers to another security for its ticker", async () => {
    const s = await seedSwitched('FOLW');
    const follower = await prisma.security.create({
      data: {
        name: 'Example Plan Trust',
        type: 'mutual_fund',
        currency: 'USD',
        pricing: Pricing.Institution,
        proxySecurityId: s.id,
      },
    });
    const { followed, repointed } = await catalogFor(fakeProvider(folw).provider).setProxy(
      s.id,
      null
    );
    const replacement = await prisma.security.findFirstOrThrow({
      where: { priceSymbol: 'FOLW', id: { not: s.id } },
    });
    expect(replacement.pricing).toBe(Pricing.Market);
    expect(
      (await prisma.security.findUniqueOrThrow({ where: { id: follower.id } })).proxySecurityId
    ).toBe(replacement.id);
    expect(followed).toEqual([replacement.id]);
    expect(repointed).toEqual([follower.id]);
  });

  it('refuses to re-point followers to a security for the ticker without a market price', async () => {
    const s = await seedSwitched('FOLW');
    const follower = await prisma.security.create({
      data: {
        name: 'Example Plan Trust',
        type: 'mutual_fund',
        currency: 'USD',
        priceSymbol: 'FOLW',
        pricing: Pricing.Institution,
        proxySecurityId: s.id,
      },
    });
    await expect(catalogFor(fakeProvider(folw).provider).setProxy(s.id, null)).rejects.toThrow(
      'Funds following FOLW have no other market price to follow'
    );
    expect(await prisma.security.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      pricing: Pricing.Market,
    });
    expect(
      (await prisma.security.findUniqueOrThrow({ where: { id: follower.id } })).proxySecurityId
    ).toBe(s.id);
  });

  it('switches back with no proxy when given null', async () => {
    const s = await seedSwitched();
    const { security: updated } = await catalogFor(fakeProvider().provider).setProxy(s.id, null);
    expect(updated).toMatchObject({
      pricing: Pricing.Institution,
      priceSymbol: null,
      priceSymbolOverride: true,
      proxySecurityId: null,
    });
    expect(await sources(s.id)).toEqual({ prices: [PriceSource.Institution], events: 0 });
  });

  it('rejects a market security with no institution price, changing nothing', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-01', 10);
    await expect(catalogFor(fakeProvider(folw).provider).setProxy(s.id, 'FOLW')).rejects.toThrow(
      'Only a fund priced by its institution can follow another fund'
    );
    expect(await prisma.security.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      pricing: Pricing.Market,
      priceSymbol: 'AAA',
      proxySecurityId: null,
    });
    expect(await sources(s.id)).toEqual({ prices: [PriceSource.Market], events: 0 });
  });

  it('unlinks an institution security without deleting any of its prices', async () => {
    const proxy = await seedSecurity(prisma, { priceSymbol: 'FOLW' });
    const s = await prisma.security.create({
      data: {
        name: 'Example Plan Trust',
        type: 'mutual_fund',
        currency: 'USD',
        pricing: Pricing.Institution,
        proxySecurityId: proxy.id,
      },
    });
    await seedPrice(prisma, s.id, '2026-10-01', 10, PriceSource.Institution);
    await seedPrice(prisma, s.id, '2026-10-02', 11, PriceSource.Market);
    await seedEvent(s.id, PriceSource.Market);
    const { security: updated } = await catalogFor(fakeProvider().provider).setProxy(s.id, null);
    expect(updated).toMatchObject({ pricing: Pricing.Institution, proxySecurityId: null });
    expect((await sources(s.id)).prices.sort()).toEqual(
      [PriceSource.Institution, PriceSource.Market].sort()
    );
    expect((await sources(s.id)).events).toBe(1);
  });

  it('writes nothing when the proxy symbol is unknown', async () => {
    const s = await seedSwitched();
    await expect(catalogFor(fakeProvider().provider).setProxy(s.id, 'NOPE')).rejects.toMatchObject({
      kind: 'unknown_symbol',
    });
    expect(await prisma.security.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      pricing: Pricing.Market,
      priceSymbol: 'AAA',
    });
    expect((await sources(s.id)).prices).toHaveLength(2);
    expect((await sources(s.id)).events).toBe(1);
  });
});
