import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import {
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
  testServices,
} from '../../../helpers/investments';
import { manualHoldingSecurityId } from '@/lib/investments/manual-holding';
import { BalanceSource, PriceSource, Pricing, SecurityType } from '@/lib/investments/codes';

let prisma: PrismaClient;
// Clock: 2026-10-09T22:00Z. The fake provider's symbol hint is 'Use test symbols.'.
const services = () => testServices(prisma).services;
const list = () => services().securityList.list();
const byLabel = async () => new Map((await list()).securities.map((s) => [s.label, s]));
const hold = (accountId: string, securityId: string, date: string, quantity: number) =>
  seedSnapshot(prisma, { accountId, securityId, date, quantity, price: 10 });

describe('SecurityListReader', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('lists securities held in snapshots and named in trades, with the symbol hint', async () => {
    const a = await seedInvestmentAccount(prisma);
    const held = await seedSecurity(prisma, { priceSymbol: 'AAA', name: 'Triple A Fund' });
    const traded = await seedSecurity(prisma, { priceSymbol: 'BBB', name: 'Double B Fund' });
    await hold(a.id, held.id, '2026-10-01', 2);
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: traded.id,
      date: '2026-09-15',
      type: 'buy',
      quantity: 1,
      amount: 20,
    });
    await seedPrice(prisma, held.id, '2026-10-08', 11);
    const result = await list();
    expect(result.symbolHint).toBe('Use test symbols.');
    expect(result.securities).toEqual([
      {
        id: held.id,
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
      {
        id: traded.id,
        label: 'BBB',
        name: 'Double B Fund',
        type: SecurityType.Etf,
        currency: 'USD',
        pricing: Pricing.Market,
        priceSymbol: 'BBB',
        proxySymbol: null,
        fixedPrice: null,
        latest: null,
        hasInstitutionPrice: false,
        heldIn: 0,
      },
    ]);
  });

  it('includes securities of inactive accounts, held in none', async () => {
    const closed = await seedInvestmentAccount(prisma, { name: 'Closed Brokerage' });
    await prisma.account.update({ where: { id: closed.id }, data: { isActive: false } });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await hold(closed.id, s.id, '2026-10-01', 5);
    expect((await byLabel()).get('AAA')?.heldIn).toBe(0);
  });

  it('counts only active accounts whose latest snapshot holds a non-zero quantity', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const other = await seedSecurity(prisma, { priceSymbol: 'BBB' });
    const holding = await seedInvestmentAccount(prisma, { name: 'Holding' });
    const olderButHolding = await seedInvestmentAccount(prisma, { name: 'Older but holding' });
    const soldToZero = await seedInvestmentAccount(prisma, { name: 'Sold to zero' });
    const movedOn = await seedInvestmentAccount(prisma, { name: 'Moved on' });
    await hold(holding.id, s.id, '2026-10-01', 5);
    await hold(olderButHolding.id, s.id, '2026-09-01', 1);
    await hold(soldToZero.id, s.id, '2026-09-01', 5);
    await hold(soldToZero.id, s.id, '2026-10-01', 0);
    await hold(movedOn.id, s.id, '2026-09-01', 5);
    await hold(movedOn.id, other.id, '2026-10-01', 3);
    const rows = await byLabel();
    expect(rows.get('AAA')?.heldIn).toBe(2);
    expect(rows.get('BBB')?.heldIn).toBe(1);
  });

  it('does not count an account whose newest snapshot day holds only a balance mirror', async () => {
    const a = await seedInvestmentAccount(prisma, { name: 'Switched' });
    const real = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await hold(a.id, real.id, '2026-09-01', 4);
    const mirror = await prisma.security.create({
      data: {
        id: manualHoldingSecurityId(a.id),
        name: 'Balance',
        type: SecurityType.Other,
        currency: 'USD',
        pricing: Pricing.Fixed,
        fixedPrice: 1,
      },
    });
    await hold(a.id, mirror.id, '2026-10-01', 500);
    const result = await list();
    expect(result.securities.map((s) => s.label)).toEqual(['AAA']);
    expect(result.securities[0].heldIn).toBe(0);
  });

  it('labels cash by its currency, not its internal-id ticker or long name', async () => {
    const a = await seedInvestmentAccount(prisma);
    const cash = await prisma.security.create({
      data: {
        name: 'Canadian  Dollar',
        ticker: 'CUR:CAD',
        type: SecurityType.Cash,
        currency: 'CAD',
        pricing: Pricing.Fixed,
        fixedPrice: 1,
      },
    });
    await hold(a.id, cash.id, '2026-10-01', 100);
    expect((await list()).securities.map((s) => s.label)).toEqual(['CAD cash']);
  });

  it('labels a cash security named "U S Dollar" as USD cash', async () => {
    const a = await seedInvestmentAccount(prisma);
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      name: 'U S Dollar',
      type: SecurityType.Cash,
      pricing: Pricing.Fixed,
      fixedPrice: 1,
    });
    await hold(a.id, cash.id, '2026-10-01', 100);
    expect((await byLabel()).get('USD cash')).toMatchObject({
      name: 'U S Dollar',
      currency: 'USD',
    });
  });

  it('flags securities with a stored institution price', async () => {
    const a = await seedInvestmentAccount(prisma);
    const switched = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const plain = await seedSecurity(prisma, { priceSymbol: 'BBB' });
    const manual = await seedSecurity(prisma, { priceSymbol: 'CCC' });
    for (const s of [switched, plain, manual]) await hold(a.id, s.id, '2026-10-01', 1);
    await seedPrice(prisma, switched.id, '2026-10-02', 10, PriceSource.Institution);
    await seedPrice(prisma, plain.id, '2026-10-02', 10);
    await seedPrice(prisma, manual.id, '2026-10-02', 10, PriceSource.Manual);
    const rows = await byLabel();
    expect(rows.get('AAA')?.hasInstitutionPrice).toBe(true);
    expect(rows.get('BBB')?.hasInstitutionPrice).toBe(false);
    expect(rows.get('CCC')?.hasInstitutionPrice).toBe(false);
  });

  it('gives the latest price each pricing mode uses, with the proxy symbol and fixed price', async () => {
    const a = await seedInvestmentAccount(prisma);
    const market = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
    const fund = await prisma.security.create({
      data: {
        name: 'Example Plan Trust',
        ticker: 'PLAN',
        type: SecurityType.MutualFund,
        currency: 'USD',
        pricing: Pricing.Institution,
        proxySecurityId: proxy.id,
      },
    });
    const manual = await seedSecurity(prisma, {
      priceSymbol: null,
      name: 'Example Share Plan',
      type: SecurityType.Other,
      pricing: Pricing.Manual,
    });
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      name: 'CAD cash',
      type: SecurityType.Cash,
      currency: 'CAD',
      pricing: Pricing.Fixed,
      fixedPrice: 1,
    });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'OLDF', pricing: Pricing.None });
    for (const s of [market, fund, manual, cash, unpriced]) {
      await hold(a.id, s.id, '2026-10-01', 1);
    }
    await seedPrice(prisma, market.id, '2026-10-07', 10);
    await seedPrice(prisma, market.id, '2026-10-08', 11);
    await seedPrice(prisma, market.id, '2026-10-09', 99, PriceSource.Institution);
    await seedPrice(prisma, fund.id, '2026-10-06', 28.5, PriceSource.Institution);
    await seedPrice(prisma, proxy.id, '2026-10-08', 50);
    await seedPrice(prisma, manual.id, '2026-09-30', 64.3, PriceSource.Manual);
    await seedPrice(prisma, unpriced.id, '2026-10-02', 7, PriceSource.Institution);
    const rows = await byLabel();
    expect(rows.get('AAA')?.latest).toEqual({ price: 11, date: '2026-10-08' });
    expect(rows.get('PLAN')).toMatchObject({
      pricing: Pricing.Institution,
      proxySymbol: 'PRXY',
      latest: { price: 28.5, date: '2026-10-06' },
    });
    expect(rows.get('Example Share Plan')?.latest).toEqual({ price: 64.3, date: '2026-09-30' });
    expect(rows.get('CAD cash')).toMatchObject({
      currency: 'CAD',
      fixedPrice: 1,
      latest: { price: 1, date: null },
    });
    expect(rows.get('OLDF')?.latest).toBeNull();
    expect(rows.has('PRXY')).toBe(false); // a proxy no account holds or trades is not listed
  });

  it('leaves out securities no investment account references, and manual-account mirrors', async () => {
    await seedSecurity(prisma, { priceSymbol: 'LONE' });
    const spending = await prisma.account.create({
      data: createAccountData({ name: 'Everyday' }),
    });
    const elsewhere = await seedSecurity(prisma, { priceSymbol: 'ELSE' });
    await hold(spending.id, elsewhere.id, '2026-10-01', 1);
    const pension = await seedInvestmentAccount(prisma, {
      balanceSource: BalanceSource.Manual,
      name: 'Pension',
    });
    await services().manualHoldings.record(pension.id, { date: '2026-10-01', balance: 500 });
    expect((await list()).securities).toEqual([]);
  });

  it('sorts by label, ignoring case, using the name when there is no ticker', async () => {
    const a = await seedInvestmentAccount(prisma);
    const seeds = [
      ['bbb', 'B Fund'],
      [null, 'Alpha Trust'],
      ['CCC', 'C Fund'],
      ['AAA', 'A Fund'],
    ] as const;
    for (const [priceSymbol, name] of seeds) {
      const s = await seedSecurity(prisma, { priceSymbol, name });
      await hold(a.id, s.id, '2026-10-01', 1);
    }
    expect((await list()).securities.map((s) => s.label)).toEqual([
      'AAA',
      'Alpha Trust',
      'bbb',
      'CCC',
    ]);
  });
});
