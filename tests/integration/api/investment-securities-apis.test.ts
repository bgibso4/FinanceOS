import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  day,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../helpers/investments';

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
import { isoDay } from '@/lib/investments/dates';
import { GET as search } from '@/app/api/investments/securities/search/route';
import { POST as create } from '@/app/api/investments/securities/route';
import { PATCH as patch } from '@/app/api/investments/securities/[id]/route';

const json = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/investments/securities', {
    method,
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('investment securities APIs', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    // Fresh services per test, so the quote cache starts empty. Clock: 2026-10-09T22:00Z.
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, {
        closes: { AAA: { '2026-10-09': 10 }, BBB: { '2026-10-09': 20 } },
        search: { aa: [{ symbol: 'AAA', name: 'Triple A', type: 'equity', exchange: 'NMS' }] },
      }).services
    );
  });

  it('GET search returns matches and requires q', async () => {
    const ok = await search(
      new NextRequest('http://localhost/api/investments/securities/search?q=aa')
    );
    expect(await ok.json()).toEqual({
      results: [{ symbol: 'AAA', name: 'Triple A', type: 'equity', exchange: 'NMS' }],
    });
    expect(
      (await search(new NextRequest('http://localhost/api/investments/securities/search'))).status
    ).toBe(400);
  });

  it('POST creates once, then reuses; unknown symbols are 400', async () => {
    const first = await create(json('POST', { symbol: 'AAA' }));
    expect(first.status).toBe(201);
    const again = await create(json('POST', { symbol: 'aaa' }));
    expect(again.status).toBe(200);
    expect((await create(json('POST', { symbol: 'NOPE' }))).status).toBe(400);
  });

  it('PATCH priceSymbol re-arms feed pricing and reprices under the new symbol', async () => {
    const s = await seedSecurity(testPrisma, { priceSymbol: 'OLD', pricing: 'none' });
    await seedPrice(testPrisma, s.id, '2026-10-01', 1);
    await seedPrice(testPrisma, s.id, '2026-10-01', 1, 'plaid');
    const res = await patch(json('PATCH', { priceSymbol: 'bbb' }), params(s.id));
    expect((await res.json()).security).toMatchObject({
      priceSymbol: 'BBB',
      pricing: 'feed',
      priceSymbolOverride: true,
    });
    const yahoo = await testPrisma.securityPrice.findMany({
      where: { securityId: s.id, source: 'yahoo' },
    });
    expect(yahoo.map((p) => [isoDay(p.date), p.close])).toEqual([['2026-10-09', 20]]);
    expect(
      await testPrisma.securityPrice.count({ where: { securityId: s.id, source: 'plaid' } })
    ).toBe(1);
  });

  it('PATCH manualPrice prices the security and revalues valued accounts', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 3,
      price: 0,
      source: 'manual',
    });
    const res = await patch(json('PATCH', { manualPrice: 7 }), params(s.id));
    expect((await res.json()).security).toMatchObject({
      pricing: 'manual',
      priceSymbolOverride: true,
    });
    expect(
      await testPrisma.accountBalance.findUnique({
        where: { accountId_date: { accountId: a.id, date: day('2026-10-09') } },
      })
    ).toMatchObject({ balance: 21, source: 'valuation' });
  });

  it('PATCH validates', async () => {
    const s = await seedSecurity(testPrisma);
    expect((await patch(json('PATCH', {}), params(s.id))).status).toBe(400);
    expect((await patch(json('PATCH', { manualPrice: -1 }), params(s.id))).status).toBe(400);
    expect((await patch(json('PATCH', { manualPrice: 1 }), params('missing'))).status).toBe(404);
    expect((await patch(json('PATCH', { priceSymbol: 'NOPE' }), params(s.id))).status).toBe(400);
  });
});
