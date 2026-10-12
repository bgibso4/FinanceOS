import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../../helpers/investments';
import { isoDay } from '@/lib/investments/dates';

let prisma: PrismaClient;

describe('InvestmentRefreshService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('prices securities, then values valued accounts', async () => {
    const valued = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: valued.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 2,
      price: 0,
      source: 'manual',
    });
    const { services } = testServices(prisma, { closes: { AAA: { '2026-10-09': 15 } } });
    const r = await services.refresh.refresh();
    expect(r).toMatchObject({ fetched: 1, valuationRows: 1 });
    expect(
      (await prisma.accountBalance.findFirstOrThrow({ where: { accountId: valued.id } })).balance
    ).toBe(30);
  });

  it('serializes concurrent refreshes', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 1,
      price: 1,
    });
    const { services, calls } = testServices(prisma, { closes: { AAA: { '2026-10-09': 1 } } });
    await Promise.all([services.refresh.refresh(), services.refresh.refresh()]);
    expect(calls).toHaveLength(1);
  });

  it('serializes saveHoldings with a concurrent refresh', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 1,
      price: 1,
    });
    const { services, calls } = testServices(prisma, { closes: { AAA: { '2026-10-09': 1 } } });
    await Promise.all([
      services.refresh.refresh(),
      services.refresh.saveHoldings(a.id, [{ securityId: s.id, quantity: 1 }]),
    ]);
    expect(calls).toHaveLength(1);
  });

  /** A valued account holding one feed security, priced under `symbol` through `lastDay`. */
  async function valuedHolding(symbol: string, lastDay: string, close: number) {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: symbol });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-08',
      quantity: 2,
      price: close,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, lastDay, close);
    return { a, s };
  }

  const todaysBalance = (accountId: string) =>
    prisma.accountBalance.findFirst({ where: { accountId, date: new Date('2026-10-09') } });

  it('setPriceSymbol serializes with a concurrent refresh, keeping only the new symbol prices', async () => {
    const { s } = await valuedHolding('OLD', '2026-10-08', 5);
    const { services, calls } = testServices(prisma, {
      closes: { OLD: { '2026-10-09': 6 }, NEW: { '2026-10-08': 40, '2026-10-09': 41 } },
    });
    await Promise.all([services.refresh.refresh(), services.refresh.setPriceSymbol(s.id, 'new')]);
    expect(calls.map((c) => c.symbol)).toEqual(['OLD', 'NEW']);
    const rows = await prisma.securityPrice.findMany({
      where: { securityId: s.id, source: 'yahoo' },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((r) => [isoDay(r.date), r.close])).toEqual([
      ['2026-10-08', 40],
      ['2026-10-09', 41],
    ]);
  });

  it("setPriceSymbol values a held security from the new symbol's close", async () => {
    const { a, s } = await valuedHolding('OLD', '2026-10-09', 5);
    const { services } = testServices(prisma, {
      closes: { NEW: { '2026-10-08': 40, '2026-10-09': 41 } },
    });
    const security = await services.refresh.setPriceSymbol(s.id, 'NEW');
    expect(security).toMatchObject({ priceSymbol: 'NEW', pricing: 'feed' });
    expect(await todaysBalance(a.id)).toMatchObject({ balance: 82, source: 'valuation' });
  });

  it('setManualPrice prices the security by hand and revalues', async () => {
    const { a, s } = await valuedHolding('OLD', '2026-10-08', 5);
    const { services } = testServices(prisma);
    const security = await services.refresh.setManualPrice(s.id, 7);
    expect(security).toMatchObject({ pricing: 'manual' });
    expect(await todaysBalance(a.id)).toMatchObject({ balance: 14, source: 'valuation' });
  });

  it('setPriceSymbol revalues every valued day since the security was first held', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'OLD' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 1,
      source: 'manual',
    });
    const weekdays = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'];
    for (const d of [...weekdays, '2026-10-08', '2026-10-09']) await seedPrice(prisma, s.id, d, 1);
    const { services } = testServices(prisma, {
      closes: {
        NEW: Object.fromEntries([...weekdays, '2026-10-08', '2026-10-09'].map((d) => [d, 2])),
      },
    });
    await services.valuation.writeBalances();
    const before = await prisma.accountBalance.findFirst({
      where: { accountId: a.id, date: new Date('2026-10-02T00:00:00Z') },
    });
    expect(before).toMatchObject({ balance: 10, source: 'valuation' });

    await services.refresh.setPriceSymbol(s.id, 'NEW');

    const rows = await prisma.accountBalance.findMany({
      where: { accountId: a.id },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((r) => [isoDay(r.date), r.balance])).toEqual(
      [...weekdays, '2026-10-08', '2026-10-09'].map((d) => [d, 20])
    );
  });
});
