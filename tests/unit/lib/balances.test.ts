import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import { getAccountBalances, getAccountBalance } from '@/lib/balances';

describe('balance resolver', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  async function cashAccount() {
    const a = await prisma.account.create({ data: createAccountData() });
    const tx = (amount: number, extra = {}) =>
      prisma.transaction.create({
        data: { accountId: a.id, date: new Date('2026-10-01'), amount, merchant: 'x', ...extra },
      });
    return { a, tx };
  }

  it('sums transactions for cash-flow accounts, excluding split parents', async () => {
    const { a, tx } = await cashAccount();
    await tx(100);
    await tx(-30);
    const parent = await tx(-50, { isSplitParent: true });
    await tx(-20, { parentTransactionId: parent.id });
    await tx(-30, { parentTransactionId: parent.id });
    const r = await getAccountBalance(prisma, a.id);
    expect(r).toEqual({ balance: 20, asOf: null, source: 'transactions' });
  });

  it('uses the latest AccountBalance for investment accounts', async () => {
    const a = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'provider',
      },
    });
    for (const [d, b] of [
      ['2026-10-01', 900],
      ['2026-10-08', 1100],
      ['2026-10-05', 1000],
    ] as const) {
      await prisma.accountBalance.create({
        data: {
          accountId: a.id,
          date: new Date(`${d}T00:00:00Z`),
          balance: b,
          currency: 'USD',
          source: 'plaid',
        },
      });
    }
    const r = await getAccountBalance(prisma, a.id);
    expect(r.balance).toBe(1100);
    expect(r.asOf?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(r.source).toBe('plaid');
  });

  it('ignores transactions for investment accounts', async () => {
    const a = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'manual',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: a.id,
        date: new Date('2026-10-01'),
        amount: 999,
        merchant: 'Balance Adjustment',
      },
    });
    await prisma.accountBalance.create({
      data: {
        accountId: a.id,
        date: new Date('2026-10-02T00:00:00Z'),
        balance: 50,
        currency: 'USD',
        source: 'manual',
      },
    });
    expect((await getAccountBalance(prisma, a.id)).balance).toBe(50);
  });

  it('returns 0 with null asOf for an investment account with no history', async () => {
    const a = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'provider',
      },
    });
    expect(await getAccountBalance(prisma, a.id)).toEqual({
      balance: 0,
      asOf: null,
      source: 'plaid',
    });
  });

  it('resolves a mixed batch', async () => {
    const { a: cash, tx } = await cashAccount();
    await tx(10);
    const inv = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'retirement' }),
        trackingMode: 'investment',
        balanceSource: 'manual',
      },
    });
    await prisma.accountBalance.create({
      data: {
        accountId: inv.id,
        date: new Date('2026-10-02T00:00:00Z'),
        balance: 77,
        currency: 'USD',
        source: 'manual',
      },
    });
    const map = await getAccountBalances(prisma, [
      { id: cash.id, trackingMode: 'cash_flow' },
      { id: inv.id, trackingMode: 'investment' },
    ]);
    expect(map.get(cash.id)?.balance).toBe(10);
    expect(map.get(inv.id)?.balance).toBe(77);
  });
});
