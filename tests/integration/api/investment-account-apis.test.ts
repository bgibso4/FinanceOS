import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  expectWarning,
  seedBalance,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../helpers/investments';
import { PriceProviderError } from '@/lib/prices/types';

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
import {
  GET as getHoldings,
  PUT as putHoldings,
} from '@/app/api/investments/accounts/[id]/holdings/route';
import {
  GET as listBalances,
  POST as postBalance,
} from '@/app/api/investments/accounts/[id]/balances/route';
import { DELETE as deleteBalance } from '@/app/api/investments/accounts/[id]/balances/[balanceId]/route';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/investments', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
/** Services on the test client, clock frozen at 2026-10-09T22:00Z, with this price feed. */
const useServices = (providerOpts: Parameters<typeof testServices>[1] = {}) =>
  vi
    .mocked(getInvestmentServices)
    .mockResolvedValue(testServices(testPrisma, providerOpts).services);

describe('investment account APIs', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    useServices();
  });

  it('PUT holdings prices new securities, then saves holdings and balance', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    useServices({ closes: { AAA: { '2026-10-09': 25 } } });
    const res = await putHoldings(
      req('PUT', { holdings: [{ securityId: s.id, quantity: 4 }] }),
      params({ id: a.id })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toHaveLength(1);
    expect(body.balance).toMatchObject({ balance: 100, source: BalanceRowSource.Valuation });
    expect(body.prices).toMatchObject({ fetched: 1 });
  });

  it('PUT holdings still saves when pricing fails', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    const failure = () => new PriceProviderError('network', 'fetch failed');
    useServices({ errors: { AAA: [failure(), failure()] } });
    const res = await expectWarning('stopping price refresh', () =>
      putHoldings(
        req('PUT', { holdings: [{ securityId: s.id, quantity: 4 }] }),
        params({ id: a.id })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBeNull();
    expect(body.prices.stopped).toBe(true);
    expect(await testPrisma.holdingSnapshot.count({ where: { accountId: a.id } })).toBe(1);
  });

  it('PUT holdings validates', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Valuation });
    expect((await putHoldings(req('PUT', { holdings: 'x' }), params({ id: a.id }))).status).toBe(
      400
    );
    expect((await putHoldings(req('PUT', { holdings: [] }), params({ id: a.id }))).status).toBe(
      400
    );
    expect(
      (await putHoldings(req('PUT', { holdings: [] }), params({ id: 'missing' }))).status
    ).toBe(404);
  });

  it('manual balances: record, list, delete', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    const created = await postBalance(
      req('POST', { date: '2026-10-01', balance: 1234.5 }),
      params({ id: a.id })
    );
    expect(created.status).toBe(201);
    const { balance } = await created.json();
    const list = await (await listBalances(req('GET'), params({ id: a.id }))).json();
    expect(list).toMatchObject({ today: '2026-10-09', enterBefore: null });
    expect(list.balances.map((b: { id: string }) => b.id)).toEqual([balance.id]);
    const del = await deleteBalance(req('DELETE'), params({ id: a.id, balanceId: balance.id }));
    expect(await del.json()).toEqual({ success: true });
    expect(
      (await deleteBalance(req('DELETE'), params({ id: a.id, balanceId: balance.id }))).status
    ).toBe(404);
  });

  it('entered balances validate body and the account’s cutoff', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    expect(
      (await postBalance(req('POST', { date: '10/01/2026', balance: 1 }), params({ id: a.id })))
        .status
    ).toBe(400);
    expect(
      (await postBalance(req('POST', { date: '2026-10-10', balance: 1 }), params({ id: a.id })))
        .status
    ).toBe(400);
    const p = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Provider });
    await seedBalance(testPrisma, p.id, '2026-09-01', 10, BalanceRowSource.Synced);
    const late = await postBalance(
      req('POST', { date: '2026-10-01', balance: 1 }),
      params({ id: p.id })
    );
    expect(late.status).toBe(400);
    expect(await late.json()).toEqual({
      error: 'Balances you enter must be dated before 2026-09-01',
    });
  });

  it('GET balances returns entered rows newest first with the cutoff and today', async () => {
    const p = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Provider });
    await seedBalance(testPrisma, p.id, '2026-03-03', 10, BalanceRowSource.Synced);
    await seedBalance(testPrisma, p.id, '2025-12-31', 1, BalanceRowSource.Manual);
    await seedBalance(testPrisma, p.id, '2026-01-31', 2, BalanceRowSource.Manual);
    const res = await listBalances(req('GET'), params({ id: p.id }));
    expect(await res.json()).toMatchObject({
      enterBefore: '2026-03-03',
      today: '2026-10-09',
      balances: [{ balance: 2 }, { balance: 1 }],
    });
  });

  it('POST balances saves a batch and reports skipped rows', async () => {
    const m = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    const res = await postBalance(
      req('POST', {
        balances: [
          { date: '2026-01-31', balance: 1 },
          { date: '2026-12-01', balance: 2 },
        ],
      }),
      params({ id: m.id })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      saved: 1,
      skipped: [{ date: '2026-12-01', reason: 'future' }],
    });
  });

  it('POST balances refuses a single entry on or after the cutoff', async () => {
    const p = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Provider });
    await seedBalance(testPrisma, p.id, '2026-03-03', 10, BalanceRowSource.Synced);
    const res = await postBalance(
      req('POST', { date: '2026-03-03', balance: 1 }),
      params({ id: p.id })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Balances you enter must be dated before 2026-03-03',
    });
  });

  it('POST balances rejects an empty batch and a malformed date', async () => {
    const m = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    const empty = await postBalance(req('POST', { balances: [] }), params({ id: m.id }));
    expect(empty.status).toBe(400);
    const bad = await postBalance(
      req('POST', { date: '2026-02-30', balance: 1 }),
      params({ id: m.id })
    );
    expect(bad.status).toBe(400);
  });

  it('GET holdings returns the current holdings and price date, archived accounts included', async () => {
    const v = await seedInvestmentAccount(testPrisma, {
      balanceSource: BalanceSource.Valuation,
      isActive: false,
    });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    await seedSnapshot(testPrisma, {
      accountId: v.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 2,
      price: 25,
    });
    await seedPrice(testPrisma, s.id, '2026-10-09', 25);
    const res = await getHoldings(req('GET'), params({ id: v.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      holdings: [{ securityId: s.id, quantity: 2, value: 50 }],
      pricesAsOf: '2026-10-09',
    });
  });
});
