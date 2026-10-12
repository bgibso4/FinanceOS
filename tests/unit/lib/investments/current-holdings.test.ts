import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  day,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
} from '../../../helpers/investments';
import { CurrentHoldingsReader } from '@/lib/investments/current-holdings';
import { manualHoldingSecurityId } from '@/lib/investments/manual-holding';

let prisma: PrismaClient;
const rates = new Map([['CAD_USD', 0.5]]); // 1 USD = 2 CAD, exact in floating point
const read = (accounts: Awaited<ReturnType<typeof seedInvestmentAccount>>[]) =>
  new CurrentHoldingsReader(prisma).read({
    accounts,
    today: day('2026-10-09'),
    rangeStart: day('2026-09-09'),
    baseCurrency: 'USD',
    rates,
  });

describe('CurrentHoldingsReader', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('prices a valued account’s latest set from the price book, with range change', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA', name: 'Triple A' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-09-01',
      quantity: 1,
      price: 5,
      source: 'manual',
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 3,
      price: 5,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, '2026-09-09', 8);
    await seedPrice(prisma, s.id, '2026-10-09', 10);
    const [r] = await read([a]);
    expect(r).toMatchObject({
      kind: 'security',
      label: 'AAA',
      name: 'Triple A',
      quantity: 3,
      price: 10,
      priceInAccount: 10,
      value: 30,
      valueBase: 30,
      gainBase: null,
      rangeChangePct: 25,
    });
  });

  it('keeps Plaid’s reported price and computes gain from cost basis', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const snap = await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-08',
      quantity: 2,
      price: 50,
    });
    await prisma.holdingSnapshot.update({ where: { id: snap.id }, data: { costBasis: 60 } });
    await seedPrice(prisma, s.id, '2026-10-09', 55);
    const [r] = await read([a]);
    expect(r).toMatchObject({ price: 50, value: 100, gainBase: 40 });
  });

  it('converts a CAD account into the base currency', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation', currency: 'CAD' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA', currency: 'USD' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 1,
      price: 75,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, '2026-10-09', 75);
    const [r] = await read([a]);
    expect(r).toMatchObject({ price: 75, priceInAccount: 150, value: 150, valueBase: 75 });
  });

  it('labels cash and a manual account’s single holding, without range change', async () => {
    const manual = await seedInvestmentAccount(prisma, {
      balanceSource: 'manual',
      name: 'Pension',
    });
    await prisma.security.create({
      data: {
        id: manualHoldingSecurityId(manual.id),
        name: 'Pension',
        type: 'other',
        pricing: 'manual',
      },
    });
    await seedSnapshot(prisma, {
      accountId: manual.id,
      securityId: manualHoldingSecurityId(manual.id),
      date: '2026-10-01',
      quantity: 1,
      price: 900,
      source: 'manual',
    });
    await seedPrice(prisma, manualHoldingSecurityId(manual.id), '2026-10-01', 900, 'manual');
    const valued = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const cash = await seedSecurity(prisma, {
      type: 'cash',
      priceSymbol: null,
      pricing: 'fixed',
      fixedPrice: 1,
      name: 'USD cash',
    });
    await seedSnapshot(prisma, {
      accountId: valued.id,
      securityId: cash.id,
      date: '2026-10-01',
      quantity: 250,
      price: 1,
      source: 'manual',
    });
    const rows = await read([manual, valued]);
    expect(rows.map((r) => [r.kind, r.label, r.value, r.rangeChangePct])).toEqual(
      expect.arrayContaining([
        ['account', 'Pension', 900, null],
        ['cash', 'Cash', 250, null],
      ])
    );
  });

  it('ignores a valued account’s leftover manual-holding mirror', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    await prisma.security.create({
      data: { id: manualHoldingSecurityId(a.id), name: 'Mirror', type: 'other', pricing: 'manual' },
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: manualHoldingSecurityId(a.id),
      date: '2026-10-09',
      quantity: 1,
      price: 900,
      source: 'manual',
    });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-05',
      quantity: 1,
      price: 10,
      source: 'manual',
    });
    expect((await read([a])).map((r) => r.label)).toEqual(['AAA']);
  });

  it('gives no range change to a fixed-price security', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, {
      priceSymbol: 'FIX',
      pricing: 'fixed',
      fixedPrice: 10,
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 1,
      price: 10,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, '2026-09-09', 9);
    await seedPrice(prisma, s.id, '2026-10-09', 10);
    const [r] = await read([a]);
    expect(r).toMatchObject({ kind: 'security', pricing: 'fixed', rangeChangePct: null });
  });

  it('gives a manual-priced security a range change from its price entries', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'MAN', pricing: 'manual' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 1,
      price: 10,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, '2026-09-09', 8, 'manual');
    await seedPrice(prisma, s.id, '2026-10-09', 10, 'manual');
    const [r] = await read([a]);
    expect(r.rangeChangePct).toBe(25);
  });

  it('returns nothing for no accounts', async () => {
    expect(await read([])).toEqual([]);
  });
});
