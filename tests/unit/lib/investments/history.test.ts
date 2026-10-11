import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  day,
  seedBalance,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
} from '../../../helpers/investments';
import { ValueHistoryService } from '@/lib/investments/history';

let prisma: PrismaClient;
let history: ValueHistoryService;
const series = (accountId: string, from: string, to: string) =>
  history.accountSeries(accountId, day(from), day(to));

describe('ValueHistoryService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
    history = new ValueHistoryService(prisma);
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('manual: entered days are exact, carried days estimated, nothing before the first entry', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await seedBalance(prisma, a.id, '2026-10-02', 100, 'manual');
    await seedBalance(prisma, a.id, '2026-10-04', 120, 'manual');
    expect(await series(a.id, '2026-10-01', '2026-10-05')).toEqual([
      { date: '2026-10-02', value: 100, isEstimated: false },
      { date: '2026-10-03', value: 100, isEstimated: true },
      { date: '2026-10-04', value: 120, isEstimated: false },
      { date: '2026-10-05', value: 120, isEstimated: true },
    ]);
  });

  it('valuation: weekend carry-forward is not an estimate', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    await seedBalance(prisma, a.id, '2026-10-02', 50, 'valuation');
    expect(await series(a.id, '2026-10-03', '2026-10-04')).toEqual([
      { date: '2026-10-03', value: 50, isEstimated: false },
      { date: '2026-10-04', value: 50, isEstimated: false },
    ]);
  });

  it('provider: does not derive before the first holdings snapshot', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma);
    await seedBalance(prisma, a.id, '2026-07-12', 900, 'manual');
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 100,
    });
    await seedBalance(prisma, a.id, '2026-10-01', 1000);
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-08-01',
      type: 'buy',
      quantity: 5,
      amount: 400,
    });
    expect(await series(a.id, '2026-09-30', '2026-09-30')).toEqual([
      { date: '2026-09-30', value: 900, isEstimated: true },
    ]);
    expect(await series(a.id, '2026-07-11', '2026-07-11')).toEqual([]);
  });

  it('provider: replays trades and cash flows after a snapshot', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 100,
    });
    await seedBalance(prisma, a.id, '2026-10-01', 1050); // 50 cash outside holdings
    await seedPrice(prisma, s.id, '2026-10-01', 100);
    await seedPrice(prisma, s.id, '2026-10-02', 110);
    await seedPrice(prisma, s.id, '2026-10-05', 120);
    await seedTrade(prisma, { accountId: a.id, date: '2026-10-02', type: 'cash', amount: -500 });
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-03',
      type: 'buy',
      quantity: 5,
      amount: 500,
    });
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-02',
      type: 'buy',
      quantity: 100,
      amount: 10000,
      isCancelled: true,
    });
    expect(await series(a.id, '2026-10-01', '2026-10-05')).toEqual([
      { date: '2026-10-01', value: 1050, isEstimated: false },
      { date: '2026-10-02', value: 1650, isEstimated: true }, // 10 × 110 + 550 cash
      { date: '2026-10-03', value: 1700, isEstimated: true }, // 15 × 110 + 50 cash
      { date: '2026-10-04', value: 1700, isEstimated: true },
      { date: '2026-10-05', value: 1850, isEstimated: true }, // 15 × 120 + 50 cash
    ]);
  });

  it('provider: a cash security moves with cash flows', async () => {
    const a = await seedInvestmentAccount(prisma);
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      type: 'cash',
      pricing: 'fixed',
      fixedPrice: 1,
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: cash.id,
      date: '2026-10-01',
      quantity: 200,
      price: 1,
    });
    await seedBalance(prisma, a.id, '2026-10-01', 200);
    await seedTrade(prisma, { accountId: a.id, date: '2026-10-02', type: 'fee', amount: 25 });
    expect((await series(a.id, '2026-10-02', '2026-10-02'))[0]).toEqual({
      date: '2026-10-02',
      value: 175,
      isEstimated: true,
    });
  });

  it('provider: an untraded plan fund interpolates quantity and price between snapshots', async () => {
    const a = await seedInvestmentAccount(prisma);
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: fund.id,
      date: '2026-10-01',
      quantity: 100,
      price: 10,
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: fund.id,
      date: '2026-10-11',
      quantity: 110,
      price: 12,
    });
    await seedPrice(prisma, fund.id, '2026-10-01', 10, 'plaid');
    await seedPrice(prisma, fund.id, '2026-10-11', 12, 'plaid');
    await seedBalance(prisma, a.id, '2026-10-01', 1000);
    await seedBalance(prisma, a.id, '2026-10-11', 1320);
    expect((await series(a.id, '2026-10-06', '2026-10-06'))[0]).toEqual({
      date: '2026-10-06',
      value: 1155, // 105 units × 11
      isEstimated: true,
    });
  });

  it('provider: a day has the same value whether or not the series extends past a later trade', async () => {
    const a = await seedInvestmentAccount(prisma);
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    for (const [date, quantity, price] of [
      ['2026-10-01', 100, 10],
      ['2026-10-11', 110, 12],
    ] as const) {
      await seedSnapshot(prisma, { accountId: a.id, securityId: fund.id, date, quantity, price });
      await seedPrice(prisma, fund.id, date, price, 'plaid');
    }
    await seedBalance(prisma, a.id, '2026-10-01', 1000);
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: fund.id,
      date: '2026-10-08',
      type: 'buy',
      quantity: 10,
      amount: 100,
    });
    const short = await series(a.id, '2026-10-06', '2026-10-06');
    const long = await series(a.id, '2026-10-06', '2026-10-10');
    expect(short[0]).toEqual(long[0]);
  });

  it('portfolio sums accounts in the base currency and flags any estimate', async () => {
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 },
    });
    const usd = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const cad = await seedInvestmentAccount(prisma, { balanceSource: 'manual', currency: 'CAD' });
    await seedBalance(prisma, usd.id, '2026-10-01', 100, 'valuation');
    await seedBalance(prisma, usd.id, '2026-10-02', 110, 'valuation');
    await prisma.accountBalance.create({
      data: {
        accountId: cad.id,
        date: day('2026-10-01'),
        balance: 400,
        currency: 'CAD',
        source: 'manual',
      },
    });
    expect(await history.portfolioSeries(day('2026-10-01'), day('2026-10-02'), 'USD')).toEqual([
      { date: '2026-10-01', value: 400, isEstimated: false },
      { date: '2026-10-02', value: 410, isEstimated: true },
    ]);
  });
});
