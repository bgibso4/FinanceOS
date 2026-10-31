import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import {
  day,
  seedBalance,
  seedInvestmentAccount,
  seedSecurity,
  seedSnapshot,
} from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import {
  EnteredBalanceService,
  isManualHoldingSecurity,
  manualHoldingSecurityId,
} from '@/lib/investments/entered-balances';
import { isoDay } from '@/lib/investments/dates';
import {
  BalanceRowSource,
  BalanceSource,
  PriceSource,
  Pricing,
  RecordSource,
} from '@/lib/investments/codes';

let prisma: PrismaClient;
let svc: EnteredBalanceService;

const snapshots = async (accountId: string) =>
  (await prisma.holdingSnapshot.findMany({ where: { accountId }, orderBy: { date: 'asc' } })).map(
    (s) => [isoDay(s.date), s.securityId, s.quantity, s.value, s.source]
  );

describe('EnteredBalanceService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
    svc = new EnteredBalanceService(prisma, fixedClock('2026-10-09T15:00:00Z'));
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('records a balance and mirrors it as the single holding', async () => {
    const a = await seedInvestmentAccount(prisma, {
      balanceSource: BalanceSource.Manual,
      currency: 'CAD',
    });
    const row = await svc.record(a.id, { date: '2026-10-01', balance: 5000 });
    expect(row).toMatchObject({ balance: 5000, currency: 'CAD', source: BalanceRowSource.Manual });
    const sid = manualHoldingSecurityId(a.id);
    expect(await snapshots(a.id)).toEqual([['2026-10-01', sid, 1, 5000, RecordSource.Manual]]);
    expect(await prisma.security.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({
      type: 'other',
      pricing: Pricing.Manual,
      currency: 'CAD',
    });
    expect(
      await prisma.securityPrice.count({ where: { securityId: sid, source: PriceSource.Manual } })
    ).toBe(1);
  });

  it('recording the same day again overwrites it', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await svc.record(a.id, { date: '2026-10-01', balance: 1 });
    await svc.record(a.id, { date: '2026-10-01', balance: 2 });
    expect(await prisma.accountBalance.count({ where: { accountId: a.id } })).toBe(1);
    expect((await snapshots(a.id)).map((s) => s[3])).toEqual([2]);
  });

  it('rejects future dates, non-numbers and non-investment accounts', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await expect(svc.record(a.id, { date: '2026-10-10', balance: 1 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(svc.record(a.id, { date: '2026-10-01', balance: NaN })).rejects.toMatchObject({
      status: 400,
    });
    const cash = await prisma.account.create({
      data: { ...createAccountData(), trackingMode: 'cash_flow' },
    });
    await expect(svc.record(cash.id, { date: '2026-10-01', balance: 1 })).rejects.toMatchObject({
      status: 400,
      message: 'Account is not an investment account',
    });
    await expect(svc.record('missing', { date: '2026-10-01', balance: 1 })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('deletes an entry and its holding row', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    const first = await svc.record(a.id, { date: '2026-10-01', balance: 1 });
    await svc.record(a.id, { date: '2026-10-05', balance: 2 });
    await svc.delete(a.id, first.id);
    expect((await svc.list(a.id)).balances.map((b) => isoDay(b.date))).toEqual(['2026-10-05']);
    expect((await snapshots(a.id)).map((s) => s[0])).toEqual(['2026-10-05']);
    await expect(svc.delete(a.id, first.id)).rejects.toMatchObject({ status: 404 });
  });

  it('backfills migrated entries and is a no-op when already in sync', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, a.id, '2026-01-27', 100, BalanceRowSource.Manual);
    await seedBalance(prisma, a.id, '2026-07-12', 150, BalanceRowSource.Manual);
    expect(await svc.sync(a.id)).toBe(true);
    expect((await snapshots(a.id)).map((s) => [s[0], s[3]])).toEqual([
      ['2026-01-27', 100],
      ['2026-07-12', 150],
    ]);
    expect(await svc.sync(a.id)).toBe(false);
  });

  it('syncAll touches manual accounts only', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
    await seedBalance(prisma, m.id, '2026-10-01', 10, BalanceRowSource.Manual);
    await seedBalance(prisma, p.id, '2026-10-01', 10, BalanceRowSource.Manual);
    expect(await svc.syncAll()).toBe(1);
    expect(await prisma.holdingSnapshot.count({ where: { accountId: p.id } })).toBe(0);
    expect(day('2026-10-01')).toEqual(
      (await prisma.holdingSnapshot.findFirstOrThrow({ where: { accountId: m.id } })).date
    );
  });

  it('sync refuses a provider account and leaves its snapshots intact', async () => {
    const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
    const sec = await seedSecurity(prisma);
    await seedSnapshot(prisma, {
      accountId: p.id,
      securityId: sec.id,
      date: '2026-10-01',
      quantity: 2,
      price: 5,
    });
    await seedBalance(prisma, p.id, '2026-10-01', 10, BalanceRowSource.Manual);
    await expect(svc.sync(p.id)).rejects.toMatchObject({ status: 400 });
    expect(await snapshots(p.id)).toEqual([['2026-10-01', sec.id, 2, 10, RecordSource.Synced]]);
  });

  it('enterBefore is the first synced balance or synced holdings day for a synced account', async () => {
    const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
    expect((await svc.list(p.id)).enterBefore).toEqual(day('2026-10-09'));
    await seedBalance(prisma, p.id, '2026-03-05', 10, BalanceRowSource.Synced);
    expect((await svc.list(p.id)).enterBefore).toEqual(day('2026-03-05'));
    const s = await seedSecurity(prisma);
    await seedSnapshot(prisma, {
      accountId: p.id,
      securityId: s.id,
      date: '2026-03-03',
      quantity: 1,
      price: 10,
    });
    expect((await svc.list(p.id)).enterBefore).toEqual(day('2026-03-03'));
  });

  it('enterBefore is the first real holdings day for a valued account, ignoring the mirror', async () => {
    const v = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, v.id, '2026-01-01', 100, BalanceRowSource.Manual);
    await svc.sync(v.id);
    await prisma.account.update({
      where: { id: v.id },
      data: { balanceSource: BalanceSource.Valuation },
    });
    expect((await svc.list(v.id)).enterBefore).toEqual(day('2026-10-09'));
    const s = await seedSecurity(prisma);
    await seedSnapshot(prisma, {
      accountId: v.id,
      securityId: s.id,
      date: '2026-05-01',
      quantity: 1,
      price: 10,
      source: RecordSource.Manual,
    });
    expect((await svc.list(v.id)).enterBefore).toEqual(day('2026-05-01'));
  });

  it('a manual account has no cutoff', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, m.id, '2026-02-01', 10, BalanceRowSource.Synced);
    expect((await svc.list(m.id)).enterBefore).toBeNull();
  });

  it('lists only entered rows, newest first', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, m.id, '2026-02-01', 10, BalanceRowSource.Manual);
    await seedBalance(prisma, m.id, '2026-03-01', 20, BalanceRowSource.Synced);
    await seedBalance(prisma, m.id, '2026-04-01', 30, BalanceRowSource.Manual);
    expect((await svc.list(m.id)).balances.map((b) => isoDay(b.date))).toEqual([
      '2026-04-01',
      '2026-02-01',
    ]);
  });

  it('records before a synced account’s cutoff and refuses on or after it', async () => {
    const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
    await seedBalance(prisma, p.id, '2026-03-03', 10, BalanceRowSource.Synced);
    await expect(svc.record(p.id, { date: '2026-03-02', balance: 9 })).resolves.toMatchObject({
      source: BalanceRowSource.Manual,
    });
    await expect(svc.record(p.id, { date: '2026-03-03', balance: 9 })).rejects.toMatchObject({
      status: 400,
      message: 'Balances you enter must be dated before 2026-03-03',
    });
    expect(await prisma.holdingSnapshot.count({ where: { accountId: p.id } })).toBe(0);
  });

  it('never overwrites a synced or valued row', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, m.id, '2026-05-01', 10, BalanceRowSource.Synced);
    await seedBalance(prisma, m.id, '2026-06-01', 20, BalanceRowSource.Valuation);
    await expect(svc.record(m.id, { date: '2026-05-01', balance: 1 })).rejects.toMatchObject({
      status: 400,
      message: 'This day already has a synced balance',
    });
    await expect(svc.record(m.id, { date: '2026-06-01', balance: 1 })).rejects.toMatchObject({
      status: 400,
      message: 'This day already has a valued balance',
    });
    expect(
      (await prisma.accountBalance.findMany({ where: { accountId: m.id } })).map((b) => b.balance)
    ).toEqual(expect.arrayContaining([10, 20]));
  });

  it('recordMany saves new and replacing rows and reports the rest in input order', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await svc.record(m.id, { date: '2026-01-31', balance: 100 });
    await svc.record(m.id, { date: '2026-03-31', balance: 50 });
    const r = await svc.recordMany(m.id, [
      { date: '2026-01-31', balance: 100 },
      { date: '2026-02-28', balance: 200 },
      { date: '2026-03-31', balance: 300 },
      { date: '2026-02-28', balance: 999 },
      { date: '2026-12-31', balance: 5 },
    ]);
    expect(r).toEqual({
      saved: 2,
      skipped: [
        { date: '2026-01-31', reason: 'already' },
        { date: '2026-02-28', reason: 'repeated' },
        { date: '2026-12-31', reason: 'future' },
      ],
    });
    expect((await snapshots(m.id)).map((s) => [s[0], s[3]])).toEqual([
      ['2026-01-31', 100],
      ['2026-02-28', 200],
      ['2026-03-31', 300],
    ]);
  });

  it('recordMany skips rows on or after a synced account’s cutoff', async () => {
    const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
    await seedBalance(prisma, p.id, '2026-03-03', 10, BalanceRowSource.Synced);
    const r = await svc.recordMany(p.id, [
      { date: '2026-03-02', balance: 1 },
      { date: '2026-03-03', balance: 2 },
    ]);
    expect(r).toEqual({ saved: 1, skipped: [{ date: '2026-03-03', reason: 'skipped' }] });
    expect(await prisma.holdingSnapshot.count({ where: { accountId: p.id } })).toBe(0);
  });

  it('recordMany writes every saved row through one transaction', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    const tx = vi.spyOn(prisma, '$transaction');
    await svc.recordMany(m.id, [
      { date: '2026-01-31', balance: 1 },
      { date: '2026-02-28', balance: 2 },
    ]);
    expect(tx.mock.calls.filter(([ops]) => Array.isArray(ops) && ops.length === 2)).toHaveLength(1);
    tx.mockRestore();
  });

  it('recordMany keeps a synced or valued row on the same date', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, m.id, '2026-05-01', 20, BalanceRowSource.Valuation);
    expect((await svc.recordMany(m.id, [{ date: '2026-05-01', balance: 1 }])).skipped).toEqual([
      { date: '2026-05-01', reason: 'kept' },
    ]);
    expect(
      await prisma.accountBalance.findFirstOrThrow({ where: { accountId: m.id } })
    ).toMatchObject({ balance: 20, source: BalanceRowSource.Valuation });
  });

  it('delete removes only that account’s entered rows', async () => {
    const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    const synced = await seedBalance(prisma, p.id, '2026-05-01', 10, BalanceRowSource.Synced);
    const other = await seedBalance(prisma, m.id, '2026-04-01', 10, BalanceRowSource.Manual);
    const own = await seedBalance(prisma, p.id, '2026-04-01', 10, BalanceRowSource.Manual);
    await expect(svc.delete(p.id, synced.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.delete(p.id, other.id)).rejects.toMatchObject({ status: 404 });
    await svc.delete(p.id, own.id);
    expect(await prisma.accountBalance.count()).toBe(2);
  });

  it('mirror sync keeps real holdings and mirrors the latest balance when newer than the last entry', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    const s = await seedSecurity(prisma);
    await seedSnapshot(prisma, {
      accountId: m.id,
      securityId: s.id,
      date: '2026-05-01',
      quantity: 1,
      price: 650,
      source: RecordSource.Manual,
    });
    await seedBalance(prisma, m.id, '2026-04-01', 600, BalanceRowSource.Manual);
    await seedBalance(prisma, m.id, '2026-06-01', 700, BalanceRowSource.Valuation);
    expect(await svc.sync(m.id)).toBe(true);
    expect(
      await prisma.holdingSnapshot.count({ where: { accountId: m.id, securityId: s.id } })
    ).toBe(1);
    expect(
      (await snapshots(m.id))
        .filter((x) => x[1] === manualHoldingSecurityId(m.id))
        .map((x) => [x[0], x[3]])
    ).toEqual([
      ['2026-04-01', 600],
      ['2026-06-01', 700],
    ]);
    expect(await svc.sync(m.id)).toBe(false);
  });
});

describe('isManualHoldingSecurity', () => {
  it('recognises any account’s mirror security and nothing else', () => {
    expect(isManualHoldingSecurity(manualHoldingSecurityId('acc-1'))).toBe(true);
    expect(isManualHoldingSecurity('sec-aaa')).toBe(false);
  });
});
