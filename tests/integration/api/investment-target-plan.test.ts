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
import { BalanceSource, Pricing, SecurityType } from '@/lib/investments/codes';
import { manualHoldingSecurityId } from '@/lib/investments/entered-balances';
import type { InvestPlan, PlanRow } from '@/lib/investments/targets/planner';

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
import { GET } from '@/app/api/investments/targets/plan/route';

type Ready = Extract<InvestPlan, { ready: true }>;

const plan = async (query = '') => {
  const res = await GET(new NextRequest(`http://localhost/api/investments/targets/plan${query}`));
  return { status: res.status, body: await res.json() };
};
const ready = async (query: string) => (await plan(query)).body as Ready;
const rowOf = (p: Ready, name: string) => p.rows.find((r) => r.name === name) as PlanRow;

let services: ReturnType<typeof testServices>['services'];

/** Stocks 100% split by region; US 50 / Developed 50 / Emerging none. Returns the ids. */
async function stocksOnly(buy: { us?: string; dev?: string } = {}) {
  const setup = await services.targets.setup();
  const stocks = setup.classes.find((c) => c.name === 'Stocks')!;
  await services.targets.save({
    section: 'classes',
    items: setup.classes.map((c) => ({ ...c, pct: c.id === stocks.id ? 100 : 0 })),
  });
  const region = (name: string) => setup.regions.find((r) => r.name === name)!;
  await services.targets.save({
    section: 'regions',
    items: setup.regions.map((r) => ({
      ...r,
      buySecurityId:
        r.name === 'US'
          ? (buy.us ?? null)
          : r.name === 'Developed ex-US'
            ? (buy.dev ?? null)
            : null,
    })),
  });
  await services.targets.save({
    section: 'countries',
    items: [
      { name: 'A', weightPct: 50, regionId: region('US').id },
      { name: 'B', weightPct: 50, regionId: region('Developed ex-US').id },
    ],
  });
  return { stocks, us: region('US'), dev: region('Developed ex-US'), setup };
}

async function hold(
  accountId: string,
  value: number,
  assign: { classId?: string | null; regionId?: string | null } = {},
  over: Parameters<typeof seedSecurity>[1] = {}
) {
  const s = await seedSecurity(testPrisma, {
    priceSymbol: null,
    name: `Fund ${Math.random()}`,
    ...over,
  });
  await testPrisma.security.update({
    where: { id: s.id },
    data: { targetClassId: assign.classId ?? null, targetRegionId: assign.regionId ?? null },
  });
  await seedSnapshot(testPrisma, {
    accountId,
    securityId: s.id,
    date: '2026-10-09',
    quantity: value,
    price: 1,
  });
  await seedPrice(testPrisma, s.id, '2026-10-09', 1);
  return s;
}

const buyFund = async (price: number, date = '2026-10-09', over = {}) => {
  const s = await seedSecurity(testPrisma, { priceSymbol: null, name: `Buy ${price}`, ...over });
  await seedPrice(testPrisma, s.id, date, price);
  return s;
};

describe('invest plan API', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    services = testServices(testPrisma).services;
    vi.mocked(getInvestmentServices).mockResolvedValue(services);
  });

  it('buys toward targets across accounts', async () => {
    const usBuy = await buyFund(50);
    const devBuy = await buyFund(40);
    const { stocks, us, dev } = await stocksOnly({ us: usBuy.id, dev: devBuy.id });
    const a = await seedInvestmentAccount(testPrisma, { name: 'A' });
    const b = await seedInvestmentAccount(testPrisma, { name: 'B' });
    await hold(a.id, 600, { classId: stocks.id, regionId: us.id });
    await hold(b.id, 200, { classId: stocks.id, regionId: us.id });
    await hold(b.id, 200, { classId: stocks.id, regionId: dev.id });

    const p = await ready('?amount=1000');
    expect(p.countedTotal).toBe(1000);
    expect(p.accountsCounted).toBe(2);
    expect(rowOf(p, 'US')).toMatchObject({
      current: 800,
      currentPct: 0.8,
      targetPct: 0.5,
      trade: 200,
      afterPct: 0.5,
      shares: 4,
    });
    expect(rowOf(p, 'Developed ex-US')).toMatchObject({
      current: 200,
      trade: 800,
      afterPct: 0.5,
      shares: 20,
    });
    expect(rowOf(p, 'Emerging')).toMatchObject({ trade: 0, shares: null, fund: null });
    expect(rowOf(p, 'US').fund).toMatchObject({ price: 50, priceDate: '2026-10-09', stale: false });
    expect(p.pricesAsOf).toBe('2026-10-09');
    expect(p.leftOut).toEqual([]);
  });

  it('converts a CAD holding', async () => {
    const { stocks, us } = await stocksOnly();
    const a = await seedInvestmentAccount(testPrisma, { currency: 'CAD' });
    await hold(a.id, 1000, { classId: stocks.id, regionId: us.id }, { currency: 'CAD' });
    await testPrisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', date: day('2026-10-09'), rate: 0.75 },
    });
    const p = await ready('');
    expect(rowOf(p, 'US').current).toBe(750);
    expect(p.countedTotal).toBe(750);
  });

  it('lists what is left out and does not count it', async () => {
    const { stocks, us } = await stocksOnly();
    const a = await seedInvestmentAccount(testPrisma, { name: 'Main' });
    const off = await seedInvestmentAccount(testPrisma, { name: 'Off' });
    await testPrisma.account.update({ where: { id: off.id }, data: { inTargets: false } });
    const manual = await seedInvestmentAccount(testPrisma, {
      name: 'Typed',
      balanceSource: BalanceSource.Manual,
    });
    await hold(a.id, 100, { classId: stocks.id, regionId: us.id });
    await hold(a.id, 30);
    await hold(a.id, 20, { classId: stocks.id });
    await hold(a.id, 10, { classId: null, regionId: us.id });
    await hold(a.id, 5, {}, { type: SecurityType.Cash, name: 'Cash' });
    await hold(off.id, 70);
    const mirror = await testPrisma.security.create({
      data: {
        id: manualHoldingSecurityId(manual.id),
        name: 'Typed',
        type: 'other',
        currency: 'USD',
        pricing: Pricing.None,
      },
    });
    await seedSnapshot(testPrisma, {
      accountId: manual.id,
      securityId: mirror.id,
      date: '2026-10-09',
      quantity: 1,
      price: 40,
    });

    const p = await ready('?amount=100');
    const count = (reason: string) => p.leftOut.filter((l) => l.reason === reason);
    expect(count('account_excluded')).toEqual([
      { label: 'Off', reason: 'account_excluded', value: 70 },
    ]);
    expect(count('typed_balance')).toEqual([
      { label: 'Typed', reason: 'typed_balance', value: 40 },
    ]);
    expect(count('cash')).toHaveLength(1);
    expect(
      count('not_counted')
        .map((l) => l.value)
        .sort()
    ).toEqual([10, 20, 30]);
    expect(p.countedTotal).toBe(100);
  });

  it('sells on lists holdings', async () => {
    const usBuy = await buyFund(50);
    const { stocks, us, dev } = await stocksOnly({ us: usBuy.id });
    const a = await seedInvestmentAccount(testPrisma, { name: 'A' });
    const b = await seedInvestmentAccount(testPrisma, { name: 'B' });
    await hold(a.id, 700, { classId: stocks.id, regionId: us.id });
    await hold(b.id, 100, { classId: stocks.id, regionId: us.id });
    await hold(b.id, 200, { classId: stocks.id, regionId: dev.id });

    const p = await ready('?amount=0&sells=1');
    const row = rowOf(p, 'US');
    expect(p.sells).toBe(true);
    expect(row.trade).toBe(-300);
    expect(row.shares).toBeNull();
    expect(row.holdings.map((h) => [h.accountName, h.value]).sort()).toEqual([
      ['A', 700],
      ['B', 100],
    ]);
    expect(rowOf(p, 'Developed ex-US').trade).toBe(300);
  });

  it('gives no shares without a price yet', async () => {
    const s = await seedSecurity(testPrisma, { priceSymbol: 'NOPX' });
    const { stocks, us } = await stocksOnly({ dev: s.id });
    const a = await seedInvestmentAccount(testPrisma);
    await hold(a.id, 100, { classId: stocks.id, regionId: us.id });
    const p = await ready('?amount=100');
    const row = rowOf(p, 'Developed ex-US');
    expect(row.trade).toBeGreaterThan(0);
    expect(row.shares).toBeNull();
    expect(row.fund).toMatchObject({ price: null, priceDate: null, stale: false });
    expect(p.pricesAsOf).toBeNull();
  });

  it('marks a price stale after three days', async () => {
    const old = await buyFund(10, '2026-10-05');
    const fresh = await buyFund(10, '2026-10-07');
    await stocksOnly({ us: old.id, dev: fresh.id });
    const p = await ready('?amount=100');
    expect(rowOf(p, 'US').fund!.stale).toBe(true);
    expect(rowOf(p, 'Developed ex-US').fund!.stale).toBe(false);
    expect(p.pricesAsOf).toBe('2026-10-05');
  });

  it('is not ready without targets', async () => {
    const setup = await services.targets.setup();
    await services.targets.save({
      section: 'classes',
      items: setup.classes.map((c) => ({ ...c, pct: 0 })),
    });
    expect((await plan('?amount=100')).body).toEqual({ ready: false, reason: 'no_class_targets' });

    await services.targets.save({
      section: 'classes',
      items: setup.classes.map((c) => ({ ...c, pct: c.splitByRegion ? 100 : 0 })),
    });
    await services.targets.save({ section: 'countries', items: [] });
    expect((await plan('?amount=100')).body).toEqual({
      ready: false,
      reason: 'no_country_weights',
    });
  });

  it('rejects a bad amount and accepts none', async () => {
    for (const bad of ['-5', 'abc', '1e12']) {
      expect((await plan(`?amount=${bad}`)).status).toBe(400);
    }
    expect((await plan('')).status).toBe(200);
  });
});
