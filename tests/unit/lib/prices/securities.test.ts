import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, fakeProvider, seedSecurity } from '../../../helpers/investments';
import { QuoteCache } from '@/lib/prices/quote-cache';
import { SecurityCatalog } from '@/lib/prices/securities';
import type { PriceProvider } from '@/lib/prices/types';
import { Pricing } from '@/lib/investments/codes';

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
