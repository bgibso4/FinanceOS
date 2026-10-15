import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { SyncPayload } from '@/lib/cloud-sync/types';
import {
  exportDatabase,
  generateChecksum,
  importDatabase,
  setPrismaClient,
  resetPrismaClient,
} from '@/lib/cloud-sync/sync';
import {
  BalanceRowSource,
  BalanceSource,
  LEGACY_CODES,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from '@/lib/investments/codes';

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
        balanceSource: BalanceSource.Provider,
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
        pricing: Pricing.Market,
        priceSymbol: 'TETF',
      },
    });
    const fund = await prisma.security.create({
      data: {
        name: 'Plan Fund',
        type: 'mutual_fund',
        pricing: Pricing.Institution,
        proxySecurityId: s.id,
        pricesFetchedFrom: new Date('2024-10-01T00:00:00.000Z'),
      },
    });
    await prisma.accountBalance.create({
      data: {
        accountId: a.id,
        date: day,
        balance: 100,
        currency: 'USD',
        source: BalanceRowSource.Synced,
      },
    });
    await prisma.securityPrice.create({
      data: { securityId: s.id, date: day, close: 50, source: PriceSource.Institution },
    });
    await prisma.securityEvent.create({
      data: {
        securityId: s.id,
        date: day,
        type: 'dividend',
        amount: 0.5,
        source: PriceSource.Market,
      },
    });
    await prisma.holdingSnapshot.create({
      data: {
        accountId: a.id,
        securityId: s.id,
        date: day,
        quantity: 2,
        price: 50,
        value: 100,
        source: RecordSource.Synced,
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
        source: RecordSource.Synced,
        linkedTransactionId: bankTx.id,
      },
    });

    const payload = await exportDatabase();
    expect(payload.data.investmentTransactions).toHaveLength(1);
    await resetTestDb();
    await importDatabase(payload);

    expect((await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).balanceSource).toBe(
      BalanceSource.Provider
    );
    expect(await prisma.accountBalance.count()).toBe(1);
    expect(await prisma.security.count()).toBe(2);
    expect(await prisma.security.findUniqueOrThrow({ where: { id: fund.id } })).toMatchObject({
      proxySecurityId: s.id,
      pricesFetchedFrom: new Date('2024-10-01T00:00:00.000Z'),
    });
    expect(await prisma.securityPrice.count()).toBe(1);
    expect(await prisma.securityEvent.count()).toBe(1);
    expect(await prisma.holdingSnapshot.count()).toBe(1);
    const inv = await prisma.investmentTransaction.findFirstOrThrow();
    expect(inv.linkedTransactionId).toBe(bankTx.id);
  });

  it('imports securities exported before proxies and fetch tracking existed', async () => {
    await prisma.security.create({
      data: {
        name: 'ETF',
        ticker: 'TETF',
        type: 'etf',
        pricing: Pricing.Market,
        priceSymbol: 'TETF',
      },
    });
    const payload = await exportDatabase();
    const old = structuredClone(payload) as unknown as {
      data: Record<string, unknown> & { securities: Record<string, unknown>[] };
      metadata: { checksum: string };
    };
    for (const s of old.data.securities) {
      delete s.proxySecurityId;
      delete s.pricesFetchedFrom;
    }
    old.metadata.checksum = await generateChecksum(old.data as never);
    await resetTestDb();
    await importDatabase(old as unknown as SyncPayload);
    expect(await prisma.security.findFirstOrThrow()).toMatchObject({
      proxySecurityId: null,
      pricesFetchedFrom: null,
    });
  });

  async function legacyPayload() {
    await prisma.account.create({ data: createAccountData() });
    const payload = await exportDatabase();
    const legacy = structuredClone(payload) as unknown as {
      data: Record<string, unknown> & { accounts: Record<string, unknown>[] };
      metadata: { checksum: string };
    };
    for (const k of [
      'accountBalances',
      'securities',
      'securityPrices',
      'securityEvents',
      'holdingSnapshots',
      'investmentTransactions',
    ])
      delete legacy.data[k];
    for (const a of legacy.data.accounts) delete a.balanceSource;
    legacy.metadata.checksum = await generateChecksum(legacy.data as never);
    return legacy as unknown as SyncPayload;
  }

  it('imports payloads from before investment support when there is no local investment data', async () => {
    const legacy = await legacyPayload();
    await resetTestDb();
    await importDatabase(legacy);
    expect(await prisma.account.count()).toBe(1);
  });

  it('refuses an old-format payload that would wipe local investment data', async () => {
    const legacy = await legacyPayload();
    const brokerage = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Provider,
      },
    });
    await prisma.accountBalance.create({
      data: {
        accountId: brokerage.id,
        date: new Date('2026-10-09T00:00:00.000Z'),
        balance: 100,
        currency: 'USD',
        source: BalanceRowSource.Synced,
      },
    });
    await expect(importDatabase(legacy)).rejects.toThrow(/older FinanceOS version/);
    expect(await prisma.accountBalance.count()).toBe(1);
    expect(await prisma.account.count()).toBe(2);
  });

  it('refuses an old-format payload when an investment-mode account exists with no rows yet', async () => {
    const legacy = await legacyPayload();
    await prisma.account.create({
      data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment' },
    });
    await expect(importDatabase(legacy)).rejects.toThrow(/older FinanceOS version/);
  });

  it('imports a snapshot uploaded before the neutral codes, translating every legacy code', async () => {
    const day = new Date('2026-10-09T00:00:00.000Z');
    const a = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Provider,
      },
    });
    const etf = await prisma.security.create({
      data: {
        name: 'ETF',
        ticker: 'TETF',
        type: SecurityType.Etf,
        pricing: Pricing.Market,
        priceSymbol: 'TETF',
      },
    });
    const plan = await prisma.security.create({
      data: { name: 'Plan Fund', type: SecurityType.MutualFund, pricing: Pricing.Institution },
    });
    await prisma.securityPrice.create({
      data: { securityId: etf.id, date: day, close: 50, source: PriceSource.Market },
    });
    await prisma.securityPrice.create({
      data: { securityId: plan.id, date: day, close: 20, source: PriceSource.Institution },
    });
    await prisma.securityEvent.create({
      data: {
        securityId: etf.id,
        date: day,
        type: 'dividend',
        amount: 0.5,
        source: PriceSource.Market,
      },
    });
    await prisma.securityEvent.create({
      data: {
        securityId: plan.id,
        date: day,
        type: 'split',
        ratio: 2,
        source: PriceSource.Institution,
      },
    });
    await prisma.accountBalance.create({
      data: {
        accountId: a.id,
        date: day,
        balance: 100,
        currency: 'USD',
        source: BalanceRowSource.Synced,
      },
    });
    await prisma.holdingSnapshot.create({
      data: {
        accountId: a.id,
        securityId: plan.id,
        date: day,
        quantity: 5,
        price: 20,
        value: 100,
        source: RecordSource.Synced,
      },
    });
    await prisma.investmentTransaction.create({
      data: {
        accountId: a.id,
        securityId: plan.id,
        date: day,
        type: 'buy',
        subtype: 'buy',
        name: 'Test buy',
        quantity: 1,
        amount: 20,
        currency: 'USD',
        source: RecordSource.Synced,
      },
    });

    // Rewrite the export as a build before the neutral codes would have written it.
    const old = structuredClone(await exportDatabase());
    const back = (legacy: Readonly<Record<string, string>>, value: string) =>
      Object.entries(legacy).find(([, now]) => now === value)?.[0] ?? value;
    for (const r of old.data.securities!) r.pricing = back(LEGACY_CODES.pricing, r.pricing);
    for (const r of old.data.securityPrices!) r.source = back(LEGACY_CODES.priceSource, r.source);
    for (const r of old.data.securityEvents!) r.source = back(LEGACY_CODES.priceSource, r.source);
    for (const r of old.data.accountBalances!) {
      r.source = back(LEGACY_CODES.balanceRowSource, r.source);
    }
    for (const r of old.data.holdingSnapshots!)
      r.source = back(LEGACY_CODES.recordSource, r.source);
    for (const r of old.data.investmentTransactions!) {
      r.source = back(LEGACY_CODES.recordSource, r.source);
    }
    expect(old.data.securities!.map((s) => s.pricing).sort()).toEqual(['feed', 'plaid']);
    expect(old.data.securityEvents!.map((e) => e.source).sort()).toEqual(['plaid', 'yahoo']);
    old.metadata.checksum = await generateChecksum(old.data);

    await resetTestDb();
    await importDatabase(old);

    expect(
      (await prisma.security.findMany({ orderBy: { name: 'asc' } })).map((s) => s.pricing)
    ).toEqual([Pricing.Market, Pricing.Institution]);
    expect(
      (await prisma.securityPrice.findMany({ orderBy: { close: 'desc' } })).map((p) => p.source)
    ).toEqual([PriceSource.Market, PriceSource.Institution]);
    expect(
      (await prisma.securityEvent.findMany({ orderBy: { type: 'asc' } })).map((e) => e.source)
    ).toEqual([PriceSource.Market, PriceSource.Institution]);
    expect((await prisma.accountBalance.findFirstOrThrow()).source).toBe(BalanceRowSource.Synced);
    expect((await prisma.holdingSnapshot.findFirstOrThrow()).source).toBe(RecordSource.Synced);
    expect((await prisma.investmentTransaction.findFirstOrThrow()).source).toBe(
      RecordSource.Synced
    );
  });
});
