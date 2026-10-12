import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedBalance,
  seedInvestmentAccount,
  seedPlaidConnection,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
  testServices,
} from '../../../helpers/investments';
import { ACTIVITY_ROWS_PER_ACCOUNT } from '@/lib/investments/activity';
import type { Range } from '@/lib/investments/portfolio-view';

let prisma: PrismaClient;
// Clock: Friday 2026-10-09 22:00Z, so 1M = 2026-09-09 … 2026-10-09.
const overview = (range: Range = '1M') => testServices(prisma).services.overview.load(range);

describe('InvestmentOverviewService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('converts a CAD account into the base currency', async () => {
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.5 },
    });
    const cad = await seedInvestmentAccount(prisma, {
      balanceSource: 'manual',
      currency: 'CAD',
      type: 'retirement',
      name: 'CAD Plan',
    });
    await seedBalance(prisma, cad.id, '2026-10-01', 200, 'manual');
    const usd = await seedInvestmentAccount(prisma, { balanceSource: 'manual', name: 'USD Plan' });
    await seedBalance(prisma, usd.id, '2026-10-01', 50, 'manual');

    const o = await overview();
    expect(o).toMatchObject({ range: '1M', today: '2026-10-09', baseCurrency: 'USD' });
    const c = o.accounts.find((a) => a.id === cad.id)!;
    expect(c).toMatchObject({
      currency: 'CAD',
      value: 200,
      valueBase: 100,
      asOf: '2026-10-01',
      group: 'Retirement',
      wrapper: 'Retirement',
      balanceSource: 'manual',
      change: null,
      prices: null,
    });
    expect(c.series[0]).toEqual({ date: '2026-10-01', value: 100, isEstimated: false });
    expect(c.series.at(-1)).toEqual({ date: '2026-10-09', value: 100, isEstimated: true });
    expect(o.portfolio.value).toBe(150);
    expect(o.portfolio.series[0]).toEqual({ date: '2026-10-01', value: 150, isEstimated: false });
  });

  it('summarizes a Plaid account with its connection status', async () => {
    const a = await seedInvestmentAccount(prisma, { type: 'retirement' });
    await seedPlaidConnection(prisma, a.id, {
      subtype: '401k',
      status: 'needs_reauth',
      pendingSteps: 'holdings',
      lastSyncAt: new Date('2026-10-08T14:00:00Z'),
    });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-02',
      quantity: 1,
      price: 100,
    });
    await seedBalance(prisma, a.id, '2026-09-20', 90);
    await seedBalance(prisma, a.id, '2026-10-02', 100);

    const [summary] = (await overview()).accounts;
    expect(summary).toMatchObject({
      institution: 'Test Bank',
      wrapper: '401(k)',
      group: 'Retirement',
      balanceSource: 'provider',
      enrollmentId: expect.any(String),
      lastSyncAt: '2026-10-08T14:00:00.000Z',
      value: 100,
      asOf: '2026-10-02',
      change: { start: 90, end: 100, delta: 10 },
      status: {
        needsReauth: { since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
        waiting: { showingFrom: '2026-10-02' },
        unpriced: [],
        tradesReported: false,
      },
    });
  });

  it('flags unpriced holdings and judges a valued account’s prices', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const priced = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    for (const s of [priced, unpriced]) {
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 1,
        price: 10,
        source: 'manual',
      });
    }
    await seedPrice(prisma, priced.id, '2026-10-06', 10);
    await seedBalance(prisma, a.id, '2026-10-06', 20, 'valuation');

    const o = await overview();
    expect(o.accounts[0].status.unpriced).toEqual([{ securityId: unpriced.id, label: 'ZZZ' }]);
    expect(o.accounts[0].prices).toEqual({ asOf: '2026-10-06', stale: true });
    expect(o.prices).toEqual({ asOf: '2026-10-06', stale: true });
    expect(o.holdings.map((h) => h.label).sort()).toEqual(['AAA', 'ZZZ']);
  });

  it('lists activity newest first, merged, without cancelled trades', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-05',
      type: 'buy',
      quantity: 1,
      amount: 10,
    });
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-06',
      type: 'sell',
      quantity: -1,
      amount: -12,
      isCancelled: true,
    });
    await seedBalance(prisma, a.id, '2026-10-05', 10);

    const o = await overview();
    expect(o.activity.map((i) => [i.date, i.title])).toEqual([['2026-10-05', 'Buy · AAA']]);
    expect(o.accounts[0].status.tradesReported).toBe(true);
  });

  it('keeps a quiet account’s activity next to a busy one', async () => {
    const busy = await seedInvestmentAccount(prisma);
    const quiet = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    for (let d = 1; d <= ACTIVITY_ROWS_PER_ACCOUNT + 2; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      await seedTrade(prisma, {
        accountId: busy.id,
        securityId: s.id,
        date,
        type: 'buy',
        quantity: 1,
        amount: 1,
      });
    }
    await seedTrade(prisma, {
      accountId: quiet.id,
      securityId: s.id,
      date: '2026-08-01',
      type: 'buy',
      quantity: 1,
      amount: 1,
    });

    const { activity } = await overview();
    expect(activity.filter((i) => i.accountId === busy.id)).toHaveLength(ACTIVITY_ROWS_PER_ACCOUNT);
    expect(activity.filter((i) => i.accountId === quiet.id)).toHaveLength(1);
  });

  it('renders an empty overview without investment accounts', async () => {
    expect(await overview()).toMatchObject({
      accounts: [],
      holdings: [],
      activity: [],
      portfolio: { value: 0, series: [], change: null },
      prices: { asOf: null, stale: false },
    });
  });

  it('uses the stored base currency', async () => {
    await prisma.userSettings.create({ data: { baseCurrency: 'CAD' } });
    expect((await overview()).baseCurrency).toBe('CAD');
  });
});
