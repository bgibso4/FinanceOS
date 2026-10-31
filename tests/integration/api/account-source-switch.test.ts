import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import {
  day,
  seedBalance,
  seedInvestmentAccount,
  seedPlaidConnection,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../helpers/investments';

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

import { getInvestmentServices, type InvestmentServices } from '@/lib/investments/services';
import { PATCH } from '@/app/api/accounts/[id]/route';
import { manualHoldingSecurityId } from '@/lib/investments/entered-balances';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

const patchReq = (body: unknown) =>
  new NextRequest('http://localhost/api/accounts', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
const params = (p: { id: string }) => ({ params: Promise.resolve(p) });

describe('account balance-source switch (PATCH /api/accounts/[id])', () => {
  let services: InvestmentServices;

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

  it('PATCH answers 404 for a missing account', async () => {
    const res = await PATCH(patchReq({ name: 'X' }), params({ id: 'missing' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Account not found' });
  });

  it('PATCH refuses converting an everyday account to investment', async () => {
    const a = await testPrisma.account.create({ data: createAccountData({ type: 'checking' }) });
    const res = await PATCH(
      patchReq({ trackingMode: 'investment', balanceSource: BalanceSource.Manual }),
      params({ id: a.id })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'An account can’t be converted to or from an investment account',
    });
    expect(await testPrisma.account.findUnique({ where: { id: a.id } })).toMatchObject({
      trackingMode: 'cash_flow',
      balanceSource: null,
    });
  });

  it('PATCH refuses Synced on an account without a connection', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    const res = await PATCH(
      patchReq({ balanceSource: BalanceSource.Provider }),
      params({ id: a.id })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Synced needs a connection to this account’s institution.',
    });
  });

  it('PATCH refuses leaving Synced while the account is connected', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Provider });
    await seedPlaidConnection(testPrisma, a.id);
    const res = await PATCH(
      patchReq({ balanceSource: BalanceSource.Manual }),
      params({ id: a.id })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Disconnect to value it or enter balances yourself.',
    });
  });

  it('PATCH Valued → Manual keeps history and writes the mirror', async () => {
    const v = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Valuation });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    await seedSnapshot(testPrisma, {
      accountId: v.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 2,
      price: 25,
    });
    await seedBalance(testPrisma, v.id, '2026-10-01', 50, BalanceRowSource.Valuation);
    await seedBalance(testPrisma, v.id, '2026-10-09', 60, BalanceRowSource.Valuation);

    const res = await PATCH(
      patchReq({ balanceSource: BalanceSource.Manual }),
      params({ id: v.id })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: v.id, balanceSource: BalanceSource.Manual });
    expect(await testPrisma.accountBalance.count({ where: { accountId: v.id } })).toBe(2);
    expect(
      await testPrisma.holdingSnapshot.count({ where: { accountId: v.id, securityId: s.id } })
    ).toBe(1);
    expect(
      await testPrisma.holdingSnapshot.findMany({
        where: { accountId: v.id, securityId: manualHoldingSecurityId(v.id) },
      })
    ).toMatchObject([{ date: day('2026-10-09'), value: 60 }]);
  });

  it('PATCH Manual → Valued keeps entered balances and leaves the mirror until holdings are saved', async () => {
    const m = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    await services.enteredBalances.record(m.id, { date: '2026-10-01', balance: 50 });
    await services.enteredBalances.record(m.id, { date: '2026-10-05', balance: 60 });
    const mirror = { accountId: m.id, securityId: manualHoldingSecurityId(m.id) };
    expect(await testPrisma.holdingSnapshot.count({ where: mirror })).toBe(2);

    const res = await PATCH(
      patchReq({ trackingMode: 'investment', balanceSource: BalanceSource.Valuation }),
      params({ id: m.id })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ balanceSource: BalanceSource.Valuation });
    expect(
      await testPrisma.accountBalance.findMany({
        where: { accountId: m.id },
        orderBy: { date: 'asc' },
      })
    ).toMatchObject([
      { date: day('2026-10-01'), balance: 50, source: BalanceRowSource.Manual },
      { date: day('2026-10-05'), balance: 60, source: BalanceRowSource.Manual },
    ]);
    expect(await testPrisma.holdingSnapshot.count({ where: mirror })).toBe(2);
  });

  it('PATCH leaves a disconnected Synced account for Valued without touching synced rows', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Provider });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-02',
      quantity: 2,
      price: 10,
    });
    for (const d of [
      '2026-10-02',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ])
      await seedPrice(testPrisma, s.id, d, 10);
    const synced = [
      ['2026-10-02', 1000],
      ['2026-10-05', 2000],
      ['2026-10-09', 3000],
    ] as const;
    for (const [d, b] of synced) await seedBalance(testPrisma, a.id, d, b);

    const res = await PATCH(
      patchReq({ balanceSource: BalanceSource.Valuation }),
      params({ id: a.id })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ balanceSource: BalanceSource.Valuation });
    const rows = await testPrisma.accountBalance.findMany({
      where: { accountId: a.id },
      orderBy: { date: 'asc' },
    });
    expect(rows.filter((r) => r.source === BalanceRowSource.Synced)).toMatchObject(
      synced.map(([d, balance]) => ({ date: day(d), balance }))
    );
    expect(
      rows.filter((r) => r.source === BalanceRowSource.Valuation).map((r) => [r.date, r.balance])
    ).toEqual([
      [day('2026-10-06'), 20],
      [day('2026-10-07'), 20],
      [day('2026-10-08'), 20],
    ]);
  });

  it('PATCH still saves ordinary fields alongside an unchanged source', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: BalanceSource.Manual });
    const res = await PATCH(
      patchReq({
        name: 'Renamed Brokerage',
        trackingMode: 'investment',
        balanceSource: BalanceSource.Manual,
      }),
      params({ id: a.id })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: 'Renamed Brokerage',
      balanceSource: BalanceSource.Manual,
    });
    expect(await testPrisma.account.findUnique({ where: { id: a.id } })).toMatchObject({
      name: 'Renamed Brokerage',
    });
  });
});
