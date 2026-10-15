import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  expectWarning,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../../helpers/investments';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { isoDay } from '@/lib/investments/dates';
import { PriceProviderError } from '@/lib/prices/types';
import {
  BalanceRowSource,
  BalanceSource,
  PriceSource,
  Pricing,
  RecordSource,
} from '@/lib/investments/codes';

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
    const valued = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: valued.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 2,
      price: 0,
      source: RecordSource.Manual,
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
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
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

  /** A valued account holding one market security, priced under `symbol` through `lastDay`. */
  async function valuedHolding(symbol: string, lastDay: string, close: number) {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(prisma, { priceSymbol: symbol });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-08',
      quantity: 2,
      price: close,
      source: RecordSource.Manual,
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
    // OLD forward, then OLD back to a week before its holding, then NEW.
    expect(calls.map((c) => c.symbol)).toEqual(['OLD', 'OLD', 'NEW']);
    const rows = await prisma.securityPrice.findMany({
      where: { securityId: s.id, source: PriceSource.Market },
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
    expect(security).toMatchObject({ priceSymbol: 'NEW', pricing: Pricing.Market });
    expect(await todaysBalance(a.id)).toMatchObject({
      balance: 82,
      source: BalanceRowSource.Valuation,
    });
  });

  it('setManualPrice prices the security by hand and revalues', async () => {
    const { a, s } = await valuedHolding('OLD', '2026-10-08', 5);
    const { services } = testServices(prisma);
    const security = await services.refresh.setManualPrice(s.id, 7);
    expect(security).toMatchObject({ pricing: Pricing.Manual });
    expect(await todaysBalance(a.id)).toMatchObject({
      balance: 14,
      source: BalanceRowSource.Valuation,
    });
  });

  it('setPriceSymbol revalues every valued day since the security was first held', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(prisma, { priceSymbol: 'OLD' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 1,
      source: RecordSource.Manual,
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
    expect(before).toMatchObject({ balance: 10, source: BalanceRowSource.Valuation });

    await services.refresh.setPriceSymbol(s.id, 'NEW');

    const rows = await prisma.accountBalance.findMany({
      where: { accountId: a.id },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((r) => [isoDay(r.date), r.balance])).toEqual(
      [...weekdays, '2026-10-08', '2026-10-09'].map((d) => [d, 20])
    );
  });

  it('setPriceSymbol keeps the valuation history when pricing the new symbol stops', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(prisma, { priceSymbol: 'OLD' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 1,
      source: RecordSource.Manual,
    });
    const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'];
    for (const d of [...days, '2026-10-08', '2026-10-09']) await seedPrice(prisma, s.id, d, 1);
    const down = () => new PriceProviderError('network', 'offline');
    const { services } = testServices(prisma, {
      closes: { NEW: { '2026-10-09': 2 } },
      errors: { NEW: [down(), down()] },
    });
    await services.valuation.writeBalances();
    const balances = async () =>
      (
        await prisma.accountBalance.findMany({
          where: { accountId: a.id },
          orderBy: { date: 'asc' },
        })
      ).map((r) => [isoDay(r.date), r.balance, r.source]);
    const before = await balances();
    expect(before).toHaveLength(7);

    const security = await services.refresh.setPriceSymbol(s.id, 'NEW');

    expect(security).toMatchObject({ priceSymbol: 'NEW', pricing: Pricing.Market });
    expect(await balances()).toEqual(before);
  });

  describe('setProxy', () => {
    async function planFund() {
      const a = await seedInvestmentAccount(prisma);
      const fund = await seedSecurity(prisma, {
        priceSymbol: 'PLAN',
        pricing: Pricing.Institution,
      });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: fund.id,
        date: '2026-10-01',
        quantity: 10,
        price: 20,
      });
      return fund;
    }

    it("links a Plaid-priced fund and prices the proxy back to the fund's history", async () => {
      const fund = await planFund();
      const { services, calls } = testServices(prisma, {
        closes: { FOLW: { '2024-10-01': 50, '2026-10-09': 60 } },
      });
      const updated = await services.refresh.setProxy(fund.id, 'folw');
      const proxy = await prisma.security.findFirstOrThrow({ where: { priceSymbol: 'FOLW' } });
      expect(updated.proxySecurityId).toBe(proxy.id);
      expect(calls).toEqual([{ symbol: 'FOLW', from: '2024-10-01', to: '2026-10-09' }]);
    });

    it("unlinks with null and keeps the proxy's prices", async () => {
      const fund = await planFund();
      const { services } = testServices(prisma, { closes: { FOLW: { '2026-10-09': 60 } } });
      await services.refresh.setProxy(fund.id, 'FOLW');
      const updated = await services.refresh.setProxy(fund.id, null);
      expect(updated.proxySecurityId).toBeNull();
      expect(await prisma.securityPrice.count({ where: { source: PriceSource.Market } })).toBe(1);
    });

    it('keeps the link when pricing the proxy stops', async () => {
      const fund = await planFund();
      const down = () => new PriceProviderError('network', 'offline');
      const { services } = testServices(prisma, {
        closes: { FOLW: { '2026-10-09': 60 } },
        errors: { FOLW: [down(), down()] },
      });
      const updated = await expectWarning('stopping', () =>
        services.refresh.setProxy(fund.id, 'FOLW')
      );
      expect(updated.proxySecurityId).not.toBeNull();
    });

    it('rejects a fund not priced by Plaid, and a fund following itself', async () => {
      const market = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      const fund = await planFund();
      const { services } = testServices(prisma, {
        closes: { FOLW: { '2026-10-09': 60 }, PLAN: { '2026-10-09': 20 } },
      });
      await expect(services.refresh.setProxy(market.id, 'FOLW')).rejects.toBeInstanceOf(
        InvestmentInputError
      );
      await expect(services.refresh.setProxy(fund.id, 'PLAN')).rejects.toBeInstanceOf(
        InvestmentInputError
      );
    });
  });
});
