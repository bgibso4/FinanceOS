import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import {
  exportDatabase,
  importDatabase,
  setPrismaClient,
  resetPrismaClient,
} from '@/lib/cloud-sync/sync';

describe('cloud sync — investment data', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    process.env.SYNC_ENCRYPTION_KEY = 'YV10ZXN0LWtleS10aGF0LWlzLWV4YWN0bHktMzItYiE=';
    prisma = await setupTestDb();
    setPrismaClient(prisma);
  });
  afterAll(async () => {
    resetPrismaClient();
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('round-trips investment tables and balanceSource', async () => {
    const day = new Date('2026-10-09T00:00:00.000Z');
    const a = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'provider',
      },
    });
    const bank = await prisma.account.create({ data: createAccountData() });
    const bankTx = await prisma.transaction.create({
      data: {
        accountId: bank.id,
        date: day,
        amount: -100,
        merchant: 'Brokerage',
        isTransfer: true,
      },
    });
    const s = await prisma.security.create({
      data: {
        plaidSecurityId: 'ps',
        name: 'ETF',
        ticker: 'TETF',
        type: 'etf',
        pricing: 'feed',
        priceSymbol: 'TETF',
      },
    });
    await prisma.accountBalance.create({
      data: { accountId: a.id, date: day, balance: 100, currency: 'USD', source: 'plaid' },
    });
    await prisma.securityPrice.create({
      data: { securityId: s.id, date: day, close: 50, source: 'plaid' },
    });
    await prisma.securityEvent.create({
      data: { securityId: s.id, date: day, type: 'dividend', amount: 0.5, source: 'yahoo' },
    });
    await prisma.holdingSnapshot.create({
      data: {
        accountId: a.id,
        securityId: s.id,
        date: day,
        quantity: 2,
        price: 50,
        value: 100,
        source: 'plaid',
      },
    });
    await prisma.investmentTransaction.create({
      data: {
        accountId: a.id,
        securityId: s.id,
        externalId: 'x',
        date: day,
        type: 'transfer',
        subtype: 'transfer',
        name: 'Tfr',
        amount: -100,
        currency: 'USD',
        source: 'plaid',
        linkedTransactionId: bankTx.id,
      },
    });

    const payload = await exportDatabase();
    expect(payload.data.investmentTransactions).toHaveLength(1);
    await resetTestDb();
    await importDatabase(payload);

    expect((await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).balanceSource).toBe(
      'provider'
    );
    expect(await prisma.accountBalance.count()).toBe(1);
    expect(await prisma.security.count()).toBe(1);
    expect(await prisma.securityPrice.count()).toBe(1);
    expect(await prisma.securityEvent.count()).toBe(1);
    expect(await prisma.holdingSnapshot.count()).toBe(1);
    const inv = await prisma.investmentTransaction.findFirstOrThrow();
    expect(inv.linkedTransactionId).toBe(bankTx.id);
  });

  it('imports payloads from before investment support', async () => {
    const payload = await exportDatabase();
    const legacy = structuredClone(payload) as unknown as { data: Record<string, unknown> };
    for (const k of [
      'accountBalances',
      'securities',
      'securityPrices',
      'securityEvents',
      'holdingSnapshots',
      'investmentTransactions',
    ])
      delete legacy.data[k];
    const { validateSyncPayload } = await import('@/lib/cloud-sync/types');
    expect(() => validateSyncPayload(legacy as never)).not.toThrow();
  });
});
