import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedBalance,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
} from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import { ValuationService } from '@/lib/investments/valuation';
import { ManualHoldingService, manualHoldingSecurityId } from '@/lib/investments/manual-holding';
import { isoDay } from '@/lib/investments/dates';

let prisma: PrismaClient;
const FRIDAY = '2026-10-09T22:00:00Z';
const MONDAY = '2026-10-05T22:00:00Z';

/** Services on a fixed clock (these tests seed prices directly). */
function at(iso: string) {
  const clock = fixedClock(iso);
  const manualHoldings = new ManualHoldingService(prisma, clock);
  return { manualHoldings, valuation: new ValuationService(prisma, manualHoldings, clock) };
}

const balances = async (accountId: string) =>
  (await prisma.accountBalance.findMany({ where: { accountId }, orderBy: { date: 'asc' } })).map(
    (b) => [isoDay(b.date), b.balance, b.source]
  );

describe('ValuationService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it("sets today's holdings priced from stored closes and writes today's balance", async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-09', 20);
    const rows = await at(FRIDAY).valuation.setHoldings(a.id, [{ securityId: s.id, quantity: 3 }]);
    expect(rows.map((r) => [isoDay(r.date), r.quantity, r.price, r.value, r.source])).toEqual([
      ['2026-10-09', 3, 20, 60, 'manual'],
    ]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 60, 'valuation']]);
  });

  it('rejects bad input', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma);
    const { valuation } = at(FRIDAY);
    const set = (h: { securityId: string; quantity: number }[]) => valuation.setHoldings(a.id, h);
    await expect(set([])).rejects.toMatchObject({ status: 400 });
    await expect(set([{ securityId: s.id, quantity: 0 }])).rejects.toMatchObject({ status: 400 });
    await expect(set([{ securityId: 'nope', quantity: 1 }])).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      set([
        { securityId: s.id, quantity: 1 },
        { securityId: s.id, quantity: 2 },
      ])
    ).rejects.toMatchObject({ status: 400 });
    const manual = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await expect(
      valuation.setHoldings(manual.id, [{ securityId: s.id, quantity: 1 }])
    ).rejects.toMatchObject({ status: 400 });
  });

  it('editing again the same day replaces the set and the balance', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s1 = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const s2 = await seedSecurity(prisma, { priceSymbol: 'BBB' });
    await seedPrice(prisma, s1.id, '2026-10-09', 10);
    await seedPrice(prisma, s2.id, '2026-10-09', 100);
    const { valuation } = at(FRIDAY);
    await valuation.setHoldings(a.id, [
      { securityId: s1.id, quantity: 1 },
      { securityId: s2.id, quantity: 1 },
    ]);
    await valuation.setHoldings(a.id, [{ securityId: s2.id, quantity: 2 }]);
    expect(
      (await prisma.holdingSnapshot.findMany({ where: { accountId: a.id } })).map((h) => [
        h.securityId,
        h.quantity,
      ])
    ).toEqual([[s2.id, 2]]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 200, 'valuation']]);
  });

  it('the first valued entry removes the manual-holding mirror', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const { manualHoldings, valuation } = at(FRIDAY);
    await seedBalance(prisma, a.id, '2026-07-12', 500, 'manual');
    await manualHoldings.sync(a.id);
    await prisma.account.update({ where: { id: a.id }, data: { balanceSource: 'valuation' } });
    const s = await seedSecurity(prisma);
    await seedPrice(prisma, s.id, '2026-10-09', 5);
    await valuation.setHoldings(a.id, [{ securityId: s.id, quantity: 100 }]);
    const sid = manualHoldingSecurityId(a.id);
    expect(await prisma.holdingSnapshot.count({ where: { securityId: sid } })).toBe(0);
    expect(await prisma.security.findUnique({ where: { id: sid } })).toBeNull();
    expect(await balances(a.id)).toEqual([
      ['2026-07-12', 500, 'manual'],
      ['2026-10-09', 500, 'valuation'],
    ]);
  });

  it('does not value the manual-holding mirror before valued holdings are set', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const { manualHoldings, valuation } = at(FRIDAY);
    await seedBalance(prisma, a.id, '2026-07-12', 500, 'manual');
    await seedBalance(prisma, a.id, '2026-08-20', 650, 'manual');
    await manualHoldings.sync(a.id);
    await prisma.account.update({ where: { id: a.id }, data: { balanceSource: 'valuation' } });
    expect(await valuation.writeBalances()).toBe(0);
    expect(await balances(a.id)).toEqual([
      ['2026-07-12', 500, 'manual'],
      ['2026-08-20', 650, 'manual'],
    ]);
  });

  it('writes one row per priced day since holdings were set, skipping weekends', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma);
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-02',
      quantity: 2,
      price: 10,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, '2026-10-02', 10);
    await seedPrice(prisma, s.id, '2026-10-05', 11);
    const { valuation } = at(MONDAY);
    expect(await valuation.writeBalances()).toBe(2);
    expect(await balances(a.id)).toEqual([
      ['2026-10-02', 20, 'valuation'],
      ['2026-10-05', 22, 'valuation'],
    ]);
    expect(await valuation.writeBalances()).toBe(0);
  });

  it('uses the holdings in effect on each day', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma);
    for (const [date, quantity] of [
      ['2026-10-02', 1],
      ['2026-10-06', 3],
    ] as const) {
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date,
        quantity,
        price: 10,
        source: 'manual',
      });
    }
    for (const d of ['2026-10-02', '2026-10-05', '2026-10-06'])
      await seedPrice(prisma, s.id, d, 10);
    await at('2026-10-06T22:00:00Z').valuation.writeBalances();
    expect((await balances(a.id)).map((b) => b[1])).toEqual([10, 10, 30]);
  });

  it('converts security currency to the account currency', async () => {
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 },
    });
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'TEQ.TO', currency: 'CAD' });
    await seedPrice(prisma, s.id, '2026-10-09', 40);
    await at(FRIDAY).valuation.setHoldings(a.id, [{ securityId: s.id, quantity: 10 }]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 300, 'valuation']]);
  });

  it('skips days where a holding has no price', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const priced = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    await seedPrice(prisma, priced.id, '2026-10-09', 10);
    await at(FRIDAY).valuation.setHoldings(a.id, [
      { securityId: priced.id, quantity: 1 },
      { securityId: unpriced.id, quantity: 1 },
    ]);
    expect(await balances(a.id)).toEqual([]);
  });

  it('removes a stale valuation row when a day becomes incomplete', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const priced = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    await seedPrice(prisma, priced.id, '2026-10-09', 10);
    const { valuation } = at(FRIDAY);
    await valuation.setHoldings(a.id, [{ securityId: priced.id, quantity: 1 }]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 10, 'valuation']]);
    await valuation.setHoldings(a.id, [
      { securityId: priced.id, quantity: 1 },
      { securityId: unpriced.id, quantity: 1 },
    ]);
    expect(await balances(a.id)).toEqual([]);
  });
});
