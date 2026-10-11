import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, seedBalance, seedInvestmentAccount } from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import { ManualHoldingService, manualHoldingSecurityId } from '@/lib/investments/manual-holding';
import { isoDay } from '@/lib/investments/dates';

let prisma: PrismaClient;
let manual: ManualHoldingService;

const snapshots = async (accountId: string) =>
  (await prisma.holdingSnapshot.findMany({ where: { accountId }, orderBy: { date: 'asc' } })).map(
    (s) => [isoDay(s.date), s.securityId, s.quantity, s.value, s.source]
  );

describe('ManualHoldingService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
    manual = new ManualHoldingService(prisma, fixedClock('2026-10-09T15:00:00Z'));
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('records a balance and mirrors it as the single holding', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual', currency: 'CAD' });
    const row = await manual.record(a.id, { date: '2026-10-01', balance: 5000 });
    expect(row).toMatchObject({ balance: 5000, currency: 'CAD', source: 'manual' });
    const sid = manualHoldingSecurityId(a.id);
    expect(await snapshots(a.id)).toEqual([['2026-10-01', sid, 1, 5000, 'manual']]);
    expect(await prisma.security.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({
      type: 'other',
      pricing: 'manual',
      currency: 'CAD',
    });
    expect(await prisma.securityPrice.count({ where: { securityId: sid, source: 'manual' } })).toBe(
      1
    );
  });

  it('recording the same day again overwrites it', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await manual.record(a.id, { date: '2026-10-01', balance: 1 });
    await manual.record(a.id, { date: '2026-10-01', balance: 2 });
    expect(await prisma.accountBalance.count({ where: { accountId: a.id } })).toBe(1);
    expect((await snapshots(a.id)).map((s) => s[3])).toEqual([2]);
  });

  it('rejects future dates, non-numbers and non-manual accounts', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await expect(manual.record(a.id, { date: '2026-10-10', balance: 1 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(manual.record(a.id, { date: '2026-10-01', balance: NaN })).rejects.toMatchObject({
      status: 400,
    });
    const p = await seedInvestmentAccount(prisma, { balanceSource: 'provider' });
    await expect(manual.record(p.id, { date: '2026-10-01', balance: 1 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      manual.record('missing', { date: '2026-10-01', balance: 1 })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deletes an entry and its holding row', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const first = await manual.record(a.id, { date: '2026-10-01', balance: 1 });
    await manual.record(a.id, { date: '2026-10-05', balance: 2 });
    await manual.delete(a.id, first.id);
    expect((await manual.list(a.id)).map((b) => isoDay(b.date))).toEqual(['2026-10-05']);
    expect((await snapshots(a.id)).map((s) => s[0])).toEqual(['2026-10-05']);
    await expect(manual.delete(a.id, first.id)).rejects.toMatchObject({ status: 404 });
  });

  it('backfills migrated entries and is a no-op when already in sync', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await seedBalance(prisma, a.id, '2026-01-27', 100, 'manual');
    await seedBalance(prisma, a.id, '2026-07-12', 150, 'manual');
    expect(await manual.sync(a.id)).toBe(true);
    expect((await snapshots(a.id)).map((s) => [s[0], s[3]])).toEqual([
      ['2026-01-27', 100],
      ['2026-07-12', 150],
    ]);
    expect(await manual.sync(a.id)).toBe(false);
  });

  it('syncAll touches manual accounts only', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const p = await seedInvestmentAccount(prisma, { balanceSource: 'provider' });
    await seedBalance(prisma, m.id, '2026-10-01', 10, 'manual');
    await seedBalance(prisma, p.id, '2026-10-01', 10, 'manual');
    expect(await manual.syncAll()).toBe(1);
    expect(await prisma.holdingSnapshot.count({ where: { accountId: p.id } })).toBe(0);
    expect(day('2026-10-01')).toEqual(
      (await prisma.holdingSnapshot.findFirstOrThrow({ where: { accountId: m.id } })).date
    );
  });
});
