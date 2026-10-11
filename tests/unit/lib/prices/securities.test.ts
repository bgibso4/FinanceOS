import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { fakeProvider, seedSecurity } from '../../../helpers/investments';
import { QuoteCache } from '@/lib/prices/quote-cache';
import { SecurityCatalog } from '@/lib/prices/securities';
import type { PriceProvider } from '@/lib/prices/types';

let prisma: PrismaClient;
const catalogFor = (provider: PriceProvider) =>
  new SecurityCatalog(prisma, provider, new QuoteCache(provider));

describe('SecurityCatalog.findOrCreateFeed', () => {
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
    const r = await catalogFor(provider).findOrCreateFeed('vti');
    expect(r).toMatchObject({ created: false, security: { id: existing.id } });
    expect(provider.getQuote).not.toHaveBeenCalled();
  });

  it('creates a feed security from quote and search', async () => {
    const { provider } = fakeProvider({
      closes: { 'TEQ.TO': { '2026-10-09': 30 } },
      currencies: { 'TEQ.TO': 'CAD' },
      search: {
        'TEQ.TO': [{ symbol: 'TEQ.TO', name: 'Test Equity ETF', type: 'etf', exchange: 'TOR' }],
      },
    });
    const { security, created } = await catalogFor(provider).findOrCreateFeed('teq.to');
    expect(created).toBe(true);
    expect(security).toMatchObject({
      ticker: 'TEQ',
      name: 'Test Equity ETF',
      type: 'etf',
      currency: 'CAD',
      priceSymbol: 'TEQ.TO',
      pricing: 'feed',
      priceSymbolOverride: true,
    });
  });

  it('throws for an unknown symbol', async () => {
    const { provider } = fakeProvider();
    await expect(catalogFor(provider).findOrCreateFeed('NOPE')).rejects.toMatchObject({
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
      pricing: 'fixed',
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
        pricing: 'fixed',
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
      pricing: 'fixed',
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
