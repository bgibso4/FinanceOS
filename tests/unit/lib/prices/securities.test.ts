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
