import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  expectWarning,
  fakeProvider,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
} from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import { PriceRefresher, RETRY_DELAY_MS, SYMBOL_GAP_MS } from '@/lib/prices/refresh';
import { PriceProviderError, type HistorySource } from '@/lib/prices/types';
import { isoDay, utcDay } from '@/lib/investments/dates';

let prisma: PrismaClient;
const clock = fixedClock('2026-10-09T22:00:00Z'); // Friday, after the close
const sleep = vi.fn(async (_ms: number) => {});
const refresher = (provider: HistorySource) => new PriceRefresher(prisma, provider, clock, sleep);

async function held(symbol: string, opts: { type?: string; pricing?: string } = {}) {
  const account = await seedInvestmentAccount(prisma);
  const security = await seedSecurity(prisma, { priceSymbol: symbol, ...opts });
  await seedSnapshot(prisma, {
    accountId: account.id,
    securityId: security.id,
    date: '2026-10-01',
    quantity: 1,
    price: 100,
  });
  return { account, security };
}

const yahooRows = async (securityId: string) =>
  (
    await prisma.securityPrice.findMany({
      where: { securityId, source: 'yahoo' },
      orderBy: { date: 'asc' },
    })
  ).map((p) => [isoDay(p.date), p.close]);

describe('PriceRefresher', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    sleep.mockClear();
  });

  it('fetches from the day after the latest stored close through the last completed trading day', async () => {
    const { security } = await held('AAA');
    await seedPrice(prisma, security.id, '2026-10-06', 100);
    const { provider, calls } = fakeProvider({
      closes: { AAA: { '2026-10-07': 101, '2026-10-08': 102, '2026-10-09': 103 } },
    });
    const r = await refresher(provider).refresh();
    expect(calls).toEqual([{ symbol: 'AAA', from: '2026-10-07', to: '2026-10-09' }]);
    expect(r).toEqual({
      fetched: 1,
      upToDate: 0,
      unknownSymbols: [],
      failedSymbols: [],
      stopped: false,
      error: null,
    });
    expect(await yahooRows(security.id)).toEqual([
      ['2026-10-06', 100],
      ['2026-10-07', 101],
      ['2026-10-08', 102],
      ['2026-10-09', 103],
    ]);
  });

  it('skips securities already priced through the last completed trading day', async () => {
    const { security } = await held('AAA');
    await seedPrice(prisma, security.id, '2026-10-09', 100);
    const { provider, calls } = fakeProvider();
    const r = await refresher(provider).refresh();
    expect(calls).toEqual([]);
    expect(r.upToDate).toBe(1);
  });

  it('starts a first fetch at the earliest holding or transaction date', async () => {
    const { account, security } = await held('AAA');
    await seedTrade(prisma, {
      accountId: account.id,
      securityId: security.id,
      date: '2026-08-14',
      type: 'buy',
      quantity: 1,
      amount: 100,
    });
    const { provider, calls } = fakeProvider({ closes: { AAA: {} } });
    await refresher(provider).refresh();
    expect(calls[0]).toEqual({ symbol: 'AAA', from: '2026-08-14', to: '2026-10-09' });
  });

  it('ignores unreferenced and non-feed securities', async () => {
    await seedSecurity(prisma, { priceSymbol: 'ZZZ' });
    await held('PLN', { pricing: 'plaid' });
    await held('AAA');
    const { provider, calls } = fakeProvider({ closes: { AAA: {} } });
    await refresher(provider).refresh();
    expect(calls.map((c) => c.symbol)).toEqual(['AAA']);
  });

  it('uses the previous UTC day as the last completed day for crypto', async () => {
    const { security } = await held('BTC-USD', { type: 'crypto' });
    await seedPrice(prisma, security.id, '2026-10-07', 60000);
    const { provider, calls } = fakeProvider({ closes: { 'BTC-USD': {} } });
    await refresher(provider).refresh();
    expect(calls).toEqual([{ symbol: 'BTC-USD', from: '2026-10-08', to: '2026-10-08' }]);
  });

  it('marks an unknown symbol as unpriced and continues', async () => {
    const { security: a } = await held('AAA');
    await held('BBB');
    const { provider } = fakeProvider({
      closes: { BBB: { '2026-10-09': 50 } },
      errors: { AAA: [new PriceProviderError('unknown_symbol', 'Not Found')] },
    });
    const r = await refresher(provider).refresh();
    expect(r).toMatchObject({ fetched: 1, unknownSymbols: ['AAA'], stopped: false });
    expect((await prisma.security.findUniqueOrThrow({ where: { id: a.id } })).pricing).toBe('none');
  });

  it('skips a symbol whose response is unusable, without retrying, and continues', async () => {
    const { security: a } = await held('AAA');
    await held('BBB');
    const { provider, calls } = fakeProvider({
      closes: { BBB: { '2026-10-09': 50 } },
      errors: { AAA: [new PriceProviderError('bad_response', 'Failed Yahoo Schema validation')] },
    });
    const r = await expectWarning('skipping AAA', () => refresher(provider).refresh());
    expect(r).toMatchObject({ fetched: 1, failedSymbols: ['AAA'], stopped: false, error: null });
    expect(calls.map((c) => c.symbol)).toEqual(['AAA', 'BBB']);
    expect(sleep).not.toHaveBeenCalledWith(RETRY_DELAY_MS);
    expect((await prisma.security.findUniqueOrThrow({ where: { id: a.id } })).pricing).toBe('feed');
  });

  it('retries once after a rate limit', async () => {
    await held('AAA');
    const { provider, calls } = fakeProvider({
      closes: { AAA: { '2026-10-09': 10 } },
      errors: { AAA: [new PriceProviderError('rate_limited', 'Too Many Requests')] },
    });
    const r = await refresher(provider).refresh();
    expect(r).toMatchObject({ fetched: 1, stopped: false });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });

  it('stops the run after a second failure and keeps prices already saved', async () => {
    const { security: a } = await held('AAA');
    await held('BBB');
    await held('CCC');
    const failure = () => new PriceProviderError('network', 'fetch failed');
    const { provider, calls } = fakeProvider({
      closes: { AAA: { '2026-10-09': 10 }, CCC: { '2026-10-09': 30 } },
      errors: { BBB: [failure(), failure()] },
    });
    const r = await expectWarning('stopping price refresh', () => refresher(provider).refresh());
    expect(r.stopped).toBe(true);
    expect(r.error).toContain('BBB');
    expect(calls.map((c) => c.symbol)).toEqual(['AAA', 'BBB', 'BBB']);
    expect(await yahooRows(a.id)).toEqual([['2026-10-09', 10]]);
  });

  it('resumes on the next run without refetching stored days', async () => {
    await held('AAA');
    await held('BBB');
    const failure = () => new PriceProviderError('network', 'fetch failed');
    const first = fakeProvider({
      closes: { AAA: { '2026-10-09': 10 } },
      errors: { BBB: [failure(), failure()] },
    });
    await expectWarning('stopping price refresh', () => refresher(first.provider).refresh());
    const second = fakeProvider({ closes: { BBB: { '2026-10-09': 20 } } });
    const r = await refresher(second.provider).refresh();
    expect(second.calls.map((c) => c.symbol)).toEqual(['BBB']);
    expect(r).toMatchObject({ fetched: 1, upToDate: 1, stopped: false });
  });

  it('waits between symbols', async () => {
    await held('AAA');
    await held('BBB');
    const { provider } = fakeProvider({ closes: { AAA: {}, BBB: {} } });
    await refresher(provider).refresh();
    expect(sleep.mock.calls).toEqual([[SYMBOL_GAP_MS]]);
  });

  it('stores dividend and split events', async () => {
    const { security } = await held('AAA');
    const { provider } = fakeProvider({
      closes: { AAA: {} },
      events: {
        AAA: [
          { date: utcDay('2026-10-02'), type: 'dividend', amount: 0.5, ratio: null },
          { date: utcDay('2026-10-05'), type: 'split', amount: null, ratio: 2 },
        ],
      },
    });
    await refresher(provider).refresh();
    const events = await prisma.securityEvent.findMany({
      where: { securityId: security.id },
      orderBy: { date: 'asc' },
    });
    expect(events.map((e) => [e.type, e.amount, e.ratio, e.source])).toEqual([
      ['dividend', 0.5, null, 'yahoo'],
      ['split', null, 2, 'yahoo'],
    ]);
  });

  it('with securityIds, prices only those, including unreferenced ones (30-day lookback)', async () => {
    await held('AAA');
    const fresh = await seedSecurity(prisma, { priceSymbol: 'NEW' });
    const { provider, calls } = fakeProvider({ closes: { NEW: {} } });
    await refresher(provider).refresh({ securityIds: [fresh.id] });
    expect(calls).toEqual([{ symbol: 'NEW', from: '2026-09-09', to: '2026-10-09' }]);
  });

  describe('freshness', () => {
    // Clock: Friday 2026-10-09 22:00Z. Exchange target 10-09 (grace 10-08); crypto 10-08 (grace 10-07).
    async function heldWithClose(symbol: string, last: string, type = 'etf') {
      const { security } = await held(symbol, { type });
      await seedPrice(prisma, security.id, last, 1);
      return security;
    }
    const freshness = (opts?: { securityIds?: string[] }) =>
      refresher(fakeProvider().provider).freshness(opts);

    it('reports the oldest exchange close and is fresh within one trading day', async () => {
      await heldWithClose('AAA', '2026-10-09');
      await heldWithClose('BBB', '2026-10-08');
      await heldWithClose('BTC-USD', '2026-10-07', 'crypto');
      const f = await freshness();
      expect(isoDay(f.asOf!)).toBe('2026-10-08');
      expect(f.stale).toBe(false);
    });

    it('is stale when an exchange close is older than the grace day', async () => {
      await heldWithClose('AAA', '2026-10-09');
      await heldWithClose('BBB', '2026-10-07');
      expect(await freshness()).toMatchObject({ stale: true });
    });

    it('is stale when crypto is older than its own grace day', async () => {
      await heldWithClose('BTC-USD', '2026-10-06', 'crypto');
      const f = await freshness();
      expect(isoDay(f.asOf!)).toBe('2026-10-06');
      expect(f.stale).toBe(true);
    });

    it('is stale for a held feed security never priced', async () => {
      await held('NEW');
      expect(await freshness()).toEqual({ asOf: null, stale: true });
    });

    it('judges only the given securities', async () => {
      const fresh = await heldWithClose('AAA', '2026-10-09');
      await heldWithClose('BBB', '2026-10-01');
      expect(await freshness({ securityIds: [fresh.id] })).toMatchObject({ stale: false });
    });

    it('has nothing to judge when no feed security is held', async () => {
      expect(await freshness()).toEqual({ asOf: null, stale: false });
    });
  });
});
