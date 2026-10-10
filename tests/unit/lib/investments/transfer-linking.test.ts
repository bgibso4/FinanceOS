import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import { isCashFlow, pickMatch, linkInvestmentTransfers } from '@/lib/investments/transfer-linking';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('isCashFlow', () => {
  it('accepts transfers and cash deposits/withdrawals/contributions only', () => {
    expect(isCashFlow({ type: 'transfer', subtype: 'transfer' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'deposit' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'withdrawal' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'contribution' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'transfer_in' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'dividend' })).toBe(false);
    expect(isCashFlow({ type: 'buy', subtype: 'buy' })).toBe(false);
  });
});

describe('pickMatch', () => {
  const inv = { date: d('2026-10-07'), amount: -2000 };
  it('returns the single candidate within window and amount', () => {
    expect(pickMatch(inv, [{ id: 'a', date: d('2026-10-06'), amount: -2000 }])).toBe('a');
  });
  it('returns null when ambiguous', () => {
    expect(
      pickMatch(inv, [
        { id: 'a', date: d('2026-10-06'), amount: -2000 },
        { id: 'b', date: d('2026-10-08'), amount: -2000 },
      ])
    ).toBeNull();
  });
  it('rejects candidates outside 5 days or with a different amount', () => {
    expect(
      pickMatch(inv, [
        { id: 'a', date: d('2026-10-01'), amount: -2000 },
        { id: 'b', date: d('2026-10-07'), amount: -1999 },
      ])
    ).toBeNull();
  });
});

describe('linkInvestmentTransfers', () => {
  let prisma: PrismaClient;
  let invAccountId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    invAccountId = (
      await prisma.account.create({
        data: {
          ...createAccountData({ type: 'brokerage' }),
          trackingMode: 'investment',
          balanceSource: 'provider',
        },
      })
    ).id;
    bankAccountId = (await prisma.account.create({ data: createAccountData() })).id;
  });

  const inv = (
    o: Partial<{
      externalId: string;
      date: Date;
      amount: number;
      type: string;
      subtype: string;
      isCancelled: boolean;
    }> = {}
  ) =>
    prisma.investmentTransaction.create({
      data: {
        accountId: invAccountId,
        externalId: o.externalId ?? 'it-1',
        date: o.date ?? d('2026-10-07'),
        type: o.type ?? 'transfer',
        subtype: o.subtype ?? 'transfer',
        name: 'Tfr',
        amount: o.amount ?? -2000,
        currency: 'USD',
        source: 'plaid',
        isCancelled: o.isCancelled ?? false,
      },
    });
  const bank = (o: Partial<{ date: Date; amount: number }> = {}) =>
    prisma.transaction.create({
      data: {
        accountId: bankAccountId,
        date: o.date ?? d('2026-10-06'),
        amount: o.amount ?? -2000,
        merchant: 'Brokerage',
      },
    });

  it('links a unique match and marks the bank side as a transfer', async () => {
    const i = await inv();
    const b = await bank();
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(1);
    expect(
      (await prisma.investmentTransaction.findUniqueOrThrow({ where: { id: i.id } }))
        .linkedTransactionId
    ).toBe(b.id);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } })).isTransfer).toBe(
      true
    );
  });

  it('leaves ambiguous matches unlinked', async () => {
    await inv();
    await bank({ date: d('2026-10-06') });
    await bank({ date: d('2026-10-08') });
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(0);
  });

  it('ignores dividends, cancelled rows and already-linked bank transactions', async () => {
    await inv({ externalId: 'div', type: 'cash', subtype: 'dividend', amount: -2000 });
    await inv({ externalId: 'cxl', isCancelled: true });
    const first = await inv({ externalId: 'it-a' });
    await bank();
    await linkInvestmentTransfers(prisma, [invAccountId]);
    await inv({ externalId: 'it-b' }); // same amount/date, bank row already taken
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(0);
    expect(
      (await prisma.investmentTransaction.findUniqueOrThrow({ where: { id: first.id } }))
        .linkedTransactionId
    ).not.toBeNull();
  });

  it('never matches transactions in other investment accounts', async () => {
    await inv();
    const other = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'manual',
      },
    });
    await prisma.transaction.create({
      data: { accountId: other.id, date: d('2026-10-06'), amount: -2000, merchant: 'x' },
    });
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(0);
  });
});
