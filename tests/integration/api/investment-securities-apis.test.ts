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
import { GET as list, POST as create } from '@/app/api/investments/securities/route';
import { PATCH as patch } from '@/app/api/investments/securities/[id]/route';
import {
  BalanceRowSource,
  BalanceSource,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from '@/lib/investments/codes';

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

  it('GET lists the securities investment accounts reference, with the symbol hint', async () => {
    const a = await seedInvestmentAccount(testPrisma);
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA', name: 'Triple A Fund' });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 2,
      price: 10,
    });
    await seedPrice(testPrisma, s.id, '2026-10-08', 11);
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      securities: [
        {
          id: s.id,
          label: 'AAA',
          name: 'Triple A Fund',
          type: SecurityType.Etf,
          currency: 'USD',
          pricing: Pricing.Market,
          priceSymbol: 'AAA',
          proxySymbol: null,
          fixedPrice: null,
          latest: { price: 11, date: '2026-10-08' },
          hasInstitutionPrice: false,
          heldIn: 1,
        },
      ],
      symbolHint: 'Use test symbols.',
    });
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

  it('POST { cash } finds or creates the currency cash security', async () => {
    const first = await create(json('POST', { cash: 'cad' }));
    expect(first.status).toBe(200);
    const { security } = await first.json();
    expect(security).toMatchObject({
      type: 'cash',
      pricing: Pricing.Fixed,
      fixedPrice: 1,
      currency: 'CAD',
    });
    const again = await (await create(json('POST', { cash: 'CAD' }))).json();
    expect(again.security.id).toBe(security.id);
    expect((await create(json('POST', { cash: 'XYZ' }))).status).toBe(400);
    expect((await create(json('POST', {}))).status).toBe(400);
  });

  it('PATCH priceSymbol re-arms market pricing and reprices under the new symbol', async () => {
    const s = await seedSecurity(testPrisma, { priceSymbol: 'OLD', pricing: Pricing.None });
    await seedPrice(testPrisma, s.id, '2026-10-01', 1);
    await seedPrice(testPrisma, s.id, '2026-10-01', 1, PriceSource.Institution);
    const res = await patch(json('PATCH', { priceSymbol: 'bbb' }), params(s.id));
    expect((await res.json()).security).toMatchObject({
      priceSymbol: 'BBB',
      pricing: Pricing.Market,
      priceSymbolOverride: true,
    });
    const yahoo = await testPrisma.securityPrice.findMany({
      where: { securityId: s.id, source: PriceSource.Market },
    });
    expect(yahoo.map((p) => [isoDay(p.date), p.close])).toEqual([['2026-10-09', 20]]);
    expect(
      await testPrisma.securityPrice.count({
        where: { securityId: s.id, source: PriceSource.Institution },
      })
    ).toBe(1);
  });

  it('PATCH manualPrice prices the security and revalues valued accounts', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'ZZZ', pricing: Pricing.None });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 3,
      price: 0,
      source: RecordSource.Manual,
    });
    const res = await patch(json('PATCH', { manualPrice: 7 }), params(s.id));
    expect((await res.json()).security).toMatchObject({
      pricing: Pricing.Manual,
      priceSymbolOverride: true,
    });
    expect(
      await testPrisma.accountBalance.findUnique({
        where: { accountId_date: { accountId: a.id, date: day('2026-10-09') } },
      })
    ).toMatchObject({ balance: 21, source: BalanceRowSource.Valuation });
  });

  it('PATCH validates', async () => {
    const s = await seedSecurity(testPrisma);
    expect((await patch(json('PATCH', {}), params(s.id))).status).toBe(400);
    expect((await patch(json('PATCH', { manualPrice: -1 }), params(s.id))).status).toBe(400);
    expect((await patch(json('PATCH', { manualPrice: 1 }), params('missing'))).status).toBe(404);
    expect((await patch(json('PATCH', { priceSymbol: 'NOPE' }), params(s.id))).status).toBe(400);
  });

  it('PATCH proxySymbol links and unlinks a proxy fund', async () => {
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, { closes: { FOLW: { '2026-10-09': 60 } } }).services
    );
    const fund = await seedSecurity(testPrisma, {
      priceSymbol: null,
      pricing: Pricing.Institution,
    });
    const linked = await patch(json('PATCH', { proxySymbol: 'FOLW' }), params(fund.id));
    expect(linked.status).toBe(200);
    expect((await linked.json()).security.proxySecurityId).toEqual(expect.any(String));
    const unlinked = await patch(json('PATCH', { proxySymbol: null }), params(fund.id));
    expect((await unlinked.json()).security.proxySecurityId).toBeNull();
  });

  it('PATCH proxySymbol switches a market security with an institution price back', async () => {
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, { closes: { FOLW: { '2026-10-09': 60 } } }).services
    );
    const a = await seedInvestmentAccount(testPrisma);
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 2,
      price: 10,
    });
    await seedPrice(testPrisma, s.id, '2026-10-02', 12, PriceSource.Institution);
    const before = (await (await list()).json()).securities;
    expect(before[0].hasInstitutionPrice).toBe(true);
    const res = await patch(json('PATCH', { proxySymbol: 'FOLW' }), params(s.id));
    expect(res.status).toBe(200);
    const row = await testPrisma.security.findUniqueOrThrow({
      where: { id: s.id },
      include: { proxy: true },
    });
    expect(row).toMatchObject({ pricing: Pricing.Institution, priceSymbol: null });
    expect(row.proxy?.priceSymbol).toBe('FOLW');
  });

  it('PATCH proxySymbol rejects unknown symbols, funds not priced by their institution, and blanks', async () => {
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, { closes: { FOLW: { '2026-10-09': 60 } } }).services
    );
    const fund = await seedSecurity(testPrisma, {
      priceSymbol: null,
      pricing: Pricing.Institution,
    });
    const market = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    expect((await patch(json('PATCH', { proxySymbol: 'NOPE' }), params(fund.id))).status).toBe(400);
    const notInstitution = await patch(json('PATCH', { proxySymbol: 'FOLW' }), params(market.id));
    expect(notInstitution.status).toBe(400);
    expect(await notInstitution.json()).toEqual({
      error: 'Only a fund priced by its institution can follow another fund',
    });
    expect((await patch(json('PATCH', { proxySymbol: '' }), params(fund.id))).status).toBe(400);
  });
});
