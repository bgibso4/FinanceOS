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
import { addDays, isoDay } from '@/lib/investments/dates';
import { BACKFILL_DAYS, MAX_DAYS, ValueHistoryService } from '@/lib/investments/history';
import { BalanceRowSource, BalanceSource, PriceSource, Pricing } from '@/lib/investments/codes';

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
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, a.id, '2026-10-02', 100, BalanceRowSource.Manual);
    await seedBalance(prisma, a.id, '2026-10-04', 120, BalanceRowSource.Manual);
    expect(await series(a.id, '2026-10-01', '2026-10-05')).toEqual([
      { date: '2026-10-02', value: 100, isEstimated: false },
      { date: '2026-10-03', value: 100, isEstimated: true },
      { date: '2026-10-04', value: 120, isEstimated: false },
      { date: '2026-10-05', value: 120, isEstimated: true },
    ]);
  });

  it('valuation: weekend carry-forward is not an estimate', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
    await seedBalance(prisma, a.id, '2026-10-02', 50, BalanceRowSource.Valuation);
    expect(await series(a.id, '2026-10-03', '2026-10-04')).toEqual([
      { date: '2026-10-03', value: 50, isEstimated: false },
      { date: '2026-10-04', value: 50, isEstimated: false },
    ]);
  });

  describe('earliestDay', () => {
    const today = day('2026-10-09');

    it('is the earliest stored balance or first synced holdings minus BACKFILL_DAYS', async () => {
      const manual = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
      await seedBalance(prisma, manual.id, '2025-03-02', 100, BalanceRowSource.Manual);
      const synced = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma);
      for (const date of ['2026-06-01', '2026-07-01']) {
        await seedSnapshot(prisma, {
          accountId: synced.id,
          securityId: s.id,
          date,
          quantity: 1,
          price: 10,
        });
      }
      expect(isoDay(await history.earliestDay(today))).toBe('2024-06-01');
      await seedBalance(prisma, manual.id, '2024-01-15', 90, BalanceRowSource.Manual);
      expect(isoDay(await history.earliestDay(today))).toBe('2024-01-15');
    });

    it('is today when no active account has a value, ignoring inactive accounts', async () => {
      expect(isoDay(await history.earliestDay(today))).toBe('2026-10-09');
      const closed = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
      await prisma.account.update({ where: { id: closed.id }, data: { isActive: false } });
      await seedBalance(prisma, closed.id, '2020-01-01', 5, BalanceRowSource.Manual);
      expect(isoDay(await history.earliestDay(today))).toBe('2026-10-09');
    });
  });

  describe('earliestDay exclusions and clamp', () => {
    const today = day('2026-10-09');

    it('ignores a synced snapshot on a non-investment account', async () => {
      const a = await seedInvestmentAccount(prisma);
      await prisma.account.update({ where: { id: a.id }, data: { trackingMode: 'transactions' } });
      const s = await seedSecurity(prisma);
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-06-01',
        quantity: 1,
        price: 10,
      });
      expect(isoDay(await history.earliestDay(today))).toBe('2026-10-09');
    });

    it('ignores a synced snapshot on an inactive investment account', async () => {
      const a = await seedInvestmentAccount(prisma);
      await prisma.account.update({ where: { id: a.id }, data: { isActive: false } });
      const s = await seedSecurity(prisma);
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-06-01',
        quantity: 1,
        price: 10,
      });
      expect(isoDay(await history.earliestDay(today))).toBe('2026-10-09');
    });

    it('never reaches back more than MAX_DAYS', async () => {
      const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
      await seedBalance(prisma, a.id, '2006-10-09', 100, BalanceRowSource.Manual);
      expect(await history.earliestDay(today)).toEqual(addDays(today, -MAX_DAYS));
    });
  });

  describe('provider backfill before the first snapshot', () => {
    it('undoes trades and cash back from the first snapshot; stored days still win', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedBalance(prisma, a.id, '2026-07-12', 900, BalanceRowSource.Manual);
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000); // no cash outside holdings
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-08-01',
        type: 'buy',
        quantity: 5,
        amount: 400,
      });
      await seedPrice(prisma, s.id, '2026-07-01', 60);
      await seedPrice(prisma, s.id, '2026-09-30', 98);
      expect(await series(a.id, '2026-09-30', '2026-09-30')).toEqual([
        { date: '2026-09-30', value: 980, isEstimated: true }, // 10 × 98
      ]);
      expect(await series(a.id, '2026-07-20', '2026-07-20')).toEqual([
        { date: '2026-07-20', value: 700, isEstimated: true }, // 5 × 60 + 400 cash before the buy
      ]);
      expect(await series(a.id, '2026-07-12', '2026-07-12')).toEqual([
        { date: '2026-07-12', value: 900, isEstimated: false },
      ]);
    });

    it('a backfilled day has the same value whatever the range', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1250); // 250 implicit cash
      await seedPrice(prisma, s.id, '2026-09-01', 90);
      const inside = (await series(a.id, '2026-09-10', '2026-10-01'))[0];
      const before = await series(a.id, '2026-09-10', '2026-09-10');
      expect(before).toEqual([inside]);
      expect(inside).toEqual({ date: '2026-09-10', value: 1150, isEstimated: true });
    });

    it('values positions only when the first snapshot day has no stored balance', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedPrice(prisma, s.id, '2026-09-01', 90);
      expect(await series(a.id, '2026-09-10', '2026-09-10')).toEqual([
        { date: '2026-09-10', value: 900, isEstimated: true },
      ]);
    });

    it('reaches back exactly BACKFILL_DAYS (730)', async () => {
      expect(BACKFILL_DAYS).toBe(730);
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedPrice(prisma, s.id, '2024-09-01', 50);
      expect(await series(a.id, '2024-09-30', '2024-10-01')).toEqual([
        { date: '2024-10-01', value: 500, isEstimated: true },
      ]);
    });

    it('stops for good at a day the trades can’t explain', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedPrice(prisma, s.id, '2026-09-01', 100);
      // Buying 15 when only 10 are held later means shares arrived without a record.
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-09-15',
        type: 'buy',
        quantity: 15,
        amount: 1500,
      });
      // Before this sell the quantity is positive again, but the line must not resume.
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-09-10',
        type: 'sell',
        quantity: -10,
        amount: -1000,
      });
      expect((await series(a.id, '2026-09-08', '2026-09-16')).map((p) => p.date)).toEqual([
        '2026-09-15',
        '2026-09-16',
      ]);
    });

    it('stops where a position sold before the snapshot has no price', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      const gone = await seedSecurity(prisma, { priceSymbol: 'GONE' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedPrice(prisma, s.id, '2026-09-01', 100);
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: gone.id,
        date: '2026-09-20',
        type: 'sell',
        quantity: -2,
        amount: -50,
      });
      expect((await series(a.id, '2026-09-19', '2026-09-20')).map((p) => p.date)).toEqual([
        '2026-09-20',
      ]);
    });

    it('brings back sold positions, moves explicit cash, and prices plan funds', async () => {
      const a = await seedInvestmentAccount(prisma);
      const cash = await seedSecurity(prisma, {
        priceSymbol: null,
        type: 'cash',
        pricing: Pricing.Fixed,
        fixedPrice: 1,
      });
      const sold = await seedSecurity(prisma, { priceSymbol: 'BBB' });
      const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
      const follower = await seedSecurity(prisma, {
        priceSymbol: null,
        pricing: Pricing.Institution,
      });
      const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
      await prisma.security.update({
        where: { id: follower.id },
        data: { proxySecurityId: proxy.id },
      });
      for (const [securityId, quantity, price] of [
        [cash.id, 600, 1],
        [plan.id, 10, 20],
        [follower.id, 10, 20],
      ] as const) {
        await seedSnapshot(prisma, {
          accountId: a.id,
          securityId,
          date: '2026-10-01',
          quantity,
          price,
        });
      }
      await seedPrice(prisma, plan.id, '2026-10-01', 20, PriceSource.Institution);
      await seedPrice(prisma, follower.id, '2026-10-01', 20, PriceSource.Institution);
      await seedPrice(prisma, proxy.id, '2026-09-01', 50);
      await seedPrice(prisma, proxy.id, '2026-10-01', 100);
      await seedPrice(prisma, sold.id, '2026-09-01', 100);
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: sold.id,
        date: '2026-09-20',
        type: 'sell',
        quantity: -4,
        amount: -400,
      });
      // 4 BBB × 100 + 200 cash + 10 plan × 20 (first known price) + 10 follower × 10 (proxy moved)
      expect(await series(a.id, '2026-09-19', '2026-09-19')).toEqual([
        { date: '2026-09-19', value: 900, isEstimated: true },
      ]);
    });

    it('undoes units bought by a share contribution recorded as a cash row', async () => {
      const a = await seedInvestmentAccount(prisma);
      const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: plan.id,
        date: '2026-10-01',
        quantity: 100,
        price: 20,
      });
      await seedPrice(prisma, plan.id, '2026-10-01', 20, PriceSource.Institution);
      await seedBalance(prisma, a.id, '2026-10-01', 2000);
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: plan.id,
        date: '2026-09-15',
        type: 'cash',
        quantity: 10,
        amount: -200,
      });
      expect(await series(a.id, '2026-09-14', '2026-09-14')).toEqual([
        { date: '2026-09-14', value: 1800, isEstimated: true }, // 90 × 20
      ]);
    });

    it('a share contribution undoes units, not cash, when the account holds explicit cash', async () => {
      const a = await seedInvestmentAccount(prisma);
      const cash = await seedSecurity(prisma, {
        priceSymbol: null,
        type: 'cash',
        pricing: Pricing.Fixed,
        fixedPrice: 1,
      });
      const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
      for (const [securityId, quantity, price] of [
        [cash.id, 50, 1],
        [plan.id, 100, 20],
      ] as const) {
        await seedSnapshot(prisma, {
          accountId: a.id,
          securityId,
          date: '2026-10-01',
          quantity,
          price,
        });
      }
      await seedPrice(prisma, plan.id, '2026-10-01', 20, PriceSource.Institution);
      await seedBalance(prisma, a.id, '2026-10-01', 2050);
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: plan.id,
        date: '2026-09-15',
        type: 'cash',
        quantity: 10,
        amount: -200,
      });
      expect(await series(a.id, '2026-09-14', '2026-09-14')).toEqual([
        { date: '2026-09-14', value: 1850, isEstimated: true }, // 90 × 20 + 50 cash
      ]);
    });
  });

  it('provider: a share contribution after a snapshot adds units without adding cash', async () => {
    const a = await seedInvestmentAccount(prisma);
    const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
    for (const [date, quantity] of [
      ['2026-10-01', 100],
      ['2026-10-11', 110],
    ] as const) {
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: plan.id,
        date,
        quantity,
        price: 20,
      });
    }
    await seedPrice(prisma, plan.id, '2026-10-01', 20, PriceSource.Institution);
    await seedPrice(prisma, plan.id, '2026-10-03', 22, PriceSource.Institution);
    await seedBalance(prisma, a.id, '2026-10-01', 2000);
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: plan.id,
      date: '2026-10-03',
      type: 'cash',
      quantity: 10,
      amount: -200,
    });
    expect((await series(a.id, '2026-10-04', '2026-10-04'))[0]).toEqual({
      date: '2026-10-04',
      value: 2420, // 110 × 22, no extra cash
      isEstimated: true,
    });
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
      pricing: Pricing.Fixed,
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
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
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
    await seedPrice(prisma, fund.id, '2026-10-01', 10, PriceSource.Institution);
    await seedPrice(prisma, fund.id, '2026-10-11', 12, PriceSource.Institution);
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
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: Pricing.Institution });
    for (const [date, quantity, price] of [
      ['2026-10-01', 100, 10],
      ['2026-10-11', 110, 12],
    ] as const) {
      await seedSnapshot(prisma, { accountId: a.id, securityId: fund.id, date, quantity, price });
      await seedPrice(prisma, fund.id, date, price, PriceSource.Institution);
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
    const usd = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
    const cad = await seedInvestmentAccount(prisma, {
      balanceSource: BalanceSource.Manual,
      currency: 'CAD',
    });
    await seedBalance(prisma, usd.id, '2026-10-01', 100, BalanceRowSource.Valuation);
    await seedBalance(prisma, usd.id, '2026-10-02', 110, BalanceRowSource.Valuation);
    await prisma.accountBalance.create({
      data: {
        accountId: cad.id,
        date: day('2026-10-01'),
        balance: 400,
        currency: 'CAD',
        source: BalanceRowSource.Manual,
      },
    });
    expect(await history.portfolioSeries(day('2026-10-01'), day('2026-10-02'), 'USD')).toEqual([
      { date: '2026-10-01', value: 400, isEstimated: false },
      { date: '2026-10-02', value: 410, isEstimated: true },
    ]);
  });
});
