import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  expectWarning,
  seedInvestmentAccount,
  seedSecurity,
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
import { PUT as putHoldings } from '@/app/api/investments/accounts/[id]/holdings/route';
import {
  GET as listBalances,
  POST as postBalance,
} from '@/app/api/investments/accounts/[id]/balances/route';
import { DELETE as deleteBalance } from '@/app/api/investments/accounts/[id]/balances/[balanceId]/route';

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
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    useServices({ closes: { AAA: { '2026-10-09': 25 } } });
    const res = await putHoldings(
      req('PUT', { holdings: [{ securityId: s.id, quantity: 4 }] }),
      params({ id: a.id })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toHaveLength(1);
    expect(body.balance).toMatchObject({ balance: 100, source: 'valuation' });
    expect(body.prices).toMatchObject({ fetched: 1 });
  });

  it('PUT holdings still saves when pricing fails', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
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
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
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
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    const created = await postBalance(
      req('POST', { date: '2026-10-01', balance: 1234.5 }),
      params({ id: a.id })
    );
    expect(created.status).toBe(201);
    const { balance } = await created.json();
    const list = await (await listBalances(req('GET'), params({ id: a.id }))).json();
    expect(list.balances.map((b: { id: string }) => b.id)).toEqual([balance.id]);
    const del = await deleteBalance(req('DELETE'), params({ id: a.id, balanceId: balance.id }));
    expect(await del.json()).toEqual({ success: true });
    expect(
      (await deleteBalance(req('DELETE'), params({ id: a.id, balanceId: balance.id }))).status
    ).toBe(404);
  });

  it('manual balances validate body and account kind', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    expect(
      (await postBalance(req('POST', { date: '10/01/2026', balance: 1 }), params({ id: a.id })))
        .status
    ).toBe(400);
    expect(
      (await postBalance(req('POST', { date: '2026-10-10', balance: 1 }), params({ id: a.id })))
        .status
    ).toBe(400);
    const p = await seedInvestmentAccount(testPrisma, { balanceSource: 'provider' });
    expect(
      (await postBalance(req('POST', { date: '2026-10-01', balance: 1 }), params({ id: p.id })))
        .status
    ).toBe(400);
  });
});
