import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../helpers/investments';
import { BalanceSource } from '@/lib/investments/codes';

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
import { GET, PUT } from '@/app/api/investments/targets/route';

const put = (body: unknown) =>
  PUT(
    new NextRequest('http://localhost/api/investments/targets', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  );
const get = () => GET(new NextRequest('http://localhost/api/investments/targets'));
const view = async () => (await get()).json();

async function heldFund(accountId: string, symbol: string, quantity: number, price: number) {
  const s = await seedSecurity(testPrisma, { priceSymbol: symbol, name: `${symbol} fund` });
  await seedSnapshot(testPrisma, {
    accountId,
    securityId: s.id,
    date: '2026-10-09',
    quantity,
    price,
  });
  await seedPrice(testPrisma, s.id, '2026-10-09', price);
  return s;
}

describe('investing targets API', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(getInvestmentServices).mockResolvedValue(testServices(testPrisma).services);
  });

  it('GET creates defaults once', async () => {
    await get();
    const v = await view();
    expect(await testPrisma.targetClass.count()).toBe(3);
    expect(await testPrisma.targetRegion.count()).toBe(3);
    expect(await testPrisma.targetCountry.count()).toBe(12);
    const byName = Object.fromEntries(
      v.final.map((f: { name: string; target: number }) => [f.name, f.target])
    );
    expect(byName['US']).toBeCloseTo(0.4502, 4);
    expect(byName['Developed ex-US']).toBeCloseTo(0.2256, 4);
    expect(byName['Emerging']).toBeCloseTo(0.1242, 4);
    expect(byName['Fixed income']).toBeCloseTo(0.15, 4);
    expect(byName['Crypto']).toBeCloseTo(0.05, 4);
  });

  it('funds and accounts list current holdings', async () => {
    const a = await seedInvestmentAccount(testPrisma, { name: 'A' });
    const b = await seedInvestmentAccount(testPrisma, { name: 'B' });
    await seedInvestmentAccount(testPrisma, { name: 'Gone', isActive: false });
    await seedInvestmentAccount(testPrisma, { name: 'Checking', type: 'checking' });
    await testPrisma.account.updateMany({
      where: { name: 'Checking' },
      data: { trackingMode: 'bank' },
    });
    const fund = await heldFund(a.id, 'AAA', 2, 100);
    await seedSnapshot(testPrisma, {
      accountId: b.id,
      securityId: fund.id,
      date: '2026-10-09',
      quantity: 3,
      price: 100,
    });
    const manual = await seedInvestmentAccount(testPrisma, {
      name: 'Typed',
      balanceSource: BalanceSource.Manual,
    });
    const { services } = testServices(testPrisma);
    vi.mocked(getInvestmentServices).mockResolvedValue(services);
    await services.enteredBalances.record(manual.id, { date: '2026-10-01', balance: 500 });

    const v = await view();
    expect(v.baseCurrency).toBe('USD');
    expect(v.funds).toEqual([
      {
        securityId: fund.id,
        label: 'AAA',
        name: 'AAA fund',
        heldIn: ['A', 'B'],
        valueBase: 500,
        classId: null,
        regionId: null,
      },
    ]);
    const names = v.accounts.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(['A', 'B', 'Typed']);
    const typed = v.accounts.find((x: { name: string }) => x.name === 'Typed');
    expect(typed).toMatchObject({ typedBalance: true, inTargets: true, valueBase: 500 });
    expect(v.accounts.find((x: { name: string }) => x.name === 'A')).toMatchObject({
      typedBalance: false,
      valueBase: 200,
    });
  });

  it('PUT classes replaces the list', async () => {
    const before = await view();
    const stocks = before.classes.find((c: { name: string }) => c.name === 'Stocks');
    const crypto = before.classes.find((c: { name: string }) => c.name === 'Crypto');
    const fixed = before.classes.find((c: { name: string }) => c.name === 'Fixed income');
    const a = await seedInvestmentAccount(testPrisma);
    const fund = await heldFund(a.id, 'BTCX', 1, 10);
    await testPrisma.security.update({
      where: { id: fund.id },
      data: { targetClassId: crypto.id, targetRegionId: before.regions[0].id },
    });

    const res = await put({
      section: 'classes',
      items: [
        { id: stocks.id, name: 'Stocks', pct: 80, splitByRegion: true, buySecurityId: null },
        { name: 'Gold', pct: 5, splitByRegion: false, buySecurityId: null },
        { id: fixed.id, name: 'Fixed income', pct: 15, splitByRegion: false, buySecurityId: null },
      ],
    });
    expect(res.status).toBe(200);
    const v = await res.json();
    expect(v.classes.map((c: { name: string }) => c.name)).toEqual([
      'Stocks',
      'Gold',
      'Fixed income',
    ]);
    expect(await testPrisma.targetClass.findUnique({ where: { id: crypto.id } })).toBeNull();
    const after = await testPrisma.security.findUniqueOrThrow({ where: { id: fund.id } });
    expect(after.targetClassId).toBeNull();
    expect(after.targetRegionId).toBeNull();
  });

  describe('validation', () => {
    const cls = (name: string, splitByRegion: boolean) => ({
      name,
      pct: 10,
      splitByRegion,
      buySecurityId: null,
    });
    const expect400 = async (res: Response, error: string) => {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    };

    it('rejects two split classes', async () => {
      await expect400(
        await put({ section: 'classes', items: [cls('A', true), cls('B', true)] }),
        'Only one class can be split by region'
      );
    });

    it('rejects a tilt of -100', async () => {
      const v = await view();
      await expect400(
        await put({
          section: 'regions',
          items: [{ id: v.regions[0].id, name: 'US', tiltPct: -100, buySecurityId: null }],
        }),
        'Tilt must be above −100%'
      );
    });

    it('rejects a country with an unknown region', async () => {
      await view();
      await expect400(
        await put({
          section: 'countries',
          items: [{ name: 'X', weightPct: 1, regionId: 'nope' }],
        }),
        'Unknown region'
      );
    });

    it('rejects a stock fund without a region', async () => {
      const v = await view();
      const stocks = v.classes.find((c: { name: string }) => c.name === 'Stocks');
      const s = await seedSecurity(testPrisma);
      await expect400(
        await put({
          section: 'funds',
          items: [{ securityId: s.id, classId: stocks.id, regionId: null }],
        }),
        'Pick a region for this fund'
      );
    });

    it('rejects a region on a fund in a class that is not split', async () => {
      const v = await view();
      const fixed = v.classes.find((c: { name: string }) => c.name === 'Fixed income');
      const s = await seedSecurity(testPrisma);
      await expect400(
        await put({
          section: 'funds',
          items: [{ securityId: s.id, classId: fixed.id, regionId: v.regions[0].id }],
        }),
        'Only funds in a class split by region have a region'
      );
    });

    it('rejects a negative percentage', async () => {
      await view();
      const res = await put({ section: 'classes', items: [{ ...cls('A', false), pct: -1 }] });
      expect(res.status).toBe(400);
    });
  });

  describe('unknown and duplicate ids', () => {
    const expect400 = async (res: Response, error: string) => {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    };
    const classItem = (over: object = {}) => ({
      name: 'Gold',
      pct: 5,
      splitByRegion: false,
      buySecurityId: null,
      ...over,
    });

    it('rejects an unknown row id with no partial write', async () => {
      const v = await view();
      await expect400(
        await put({
          section: 'classes',
          items: [{ ...classItem({ id: 'nope' }) }, { ...classItem({ id: v.classes[0].id }) }],
        }),
        'Unknown class'
      );
      expect((await view()).classes.map((c: { name: string }) => c.name)).toEqual([
        'Stocks',
        'Fixed income',
        'Crypto',
      ]);
    });

    it('rejects an unknown securityId on funds', async () => {
      await view();
      await expect400(
        await put({
          section: 'funds',
          items: [{ securityId: 'nope', classId: null, regionId: null }],
        }),
        'Unknown security'
      );
    });

    it('rejects an unknown or inactive accountId with no partial write', async () => {
      const a = await seedInvestmentAccount(testPrisma);
      const gone = await seedInvestmentAccount(testPrisma, { isActive: false });
      for (const bad of ['nope', gone.id]) {
        await expect400(
          await put({
            section: 'accounts',
            items: [
              { accountId: a.id, inTargets: false },
              { accountId: bad, inTargets: false },
            ],
          }),
          'Unknown account'
        );
      }
      expect((await testPrisma.account.findUniqueOrThrow({ where: { id: a.id } })).inTargets).toBe(
        true
      );
    });

    it('rejects an unknown buySecurityId', async () => {
      await view();
      await expect400(
        await put({ section: 'classes', items: [classItem({ buySecurityId: 'nope' })] }),
        'Unknown security'
      );
      await expect400(
        await put({
          section: 'regions',
          items: [{ name: 'US', tiltPct: 0, buySecurityId: 'nope' }],
        }),
        'Unknown security'
      );
    });

    it('rejects duplicate ids', async () => {
      const v = await view();
      const id = v.classes[0].id;
      await expect400(
        await put({ section: 'classes', items: [classItem({ id }), classItem({ id })] }),
        'Duplicate id'
      );
    });

    it('rejects an empty classes list', async () => {
      await view();
      await expect400(await put({ section: 'classes', items: [] }), 'Keep at least one class');
      expect(await testPrisma.targetClass.count()).toBe(3);
    });
  });

  it('PUT accounts saves inTargets', async () => {
    const a = await seedInvestmentAccount(testPrisma);
    const res = await put({ section: 'accounts', items: [{ accountId: a.id, inTargets: false }] });
    expect(res.status).toBe(200);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: a.id } })).inTargets).toBe(
      false
    );
  });

  it('PUT funds with both values null clears the assignment', async () => {
    const v = await view();
    const fixed = v.classes.find((c: { name: string }) => c.name === 'Fixed income');
    const s = await seedSecurity(testPrisma);
    await put({
      section: 'funds',
      items: [{ securityId: s.id, classId: fixed.id, regionId: null }],
    });
    expect(
      (await testPrisma.security.findUniqueOrThrow({ where: { id: s.id } })).targetClassId
    ).toBe(fixed.id);
    await put({ section: 'funds', items: [{ securityId: s.id, classId: null, regionId: null }] });
    const after = await testPrisma.security.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.targetClassId).toBeNull();
    expect(after.targetRegionId).toBeNull();
  });
});
