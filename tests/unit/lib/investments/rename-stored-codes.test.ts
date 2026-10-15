import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  day,
  seedBalance,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
} from '../../../helpers/investments';
import {
  BalanceRowSource,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from '@/lib/investments/codes';
import { isoDay } from '@/lib/investments/dates';
import { renameStoredSourceCodes } from '@/lib/investments/rename-stored-codes';

let prisma: PrismaClient;

describe('renameStoredSourceCodes', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('rewrites every legacy code, reports counts, and is idempotent', async () => {
    const a = await seedInvestmentAccount(prisma);
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: 'feed' });
    const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      pricing: Pricing.Fixed,
      fixedPrice: 1,
      type: SecurityType.Cash,
    });
    await seedPrice(prisma, etf.id, '2026-10-01', 10, 'yahoo');
    await seedPrice(prisma, plan.id, '2026-10-01', 20, 'plaid');
    await prisma.securityEvent.create({
      data: {
        securityId: etf.id,
        date: day('2026-10-01'),
        type: 'dividend',
        amount: 0.1,
        source: 'yahoo',
      },
    });
    await prisma.securityEvent.create({
      data: {
        securityId: plan.id,
        date: day('2026-10-01'),
        type: 'split',
        ratio: 2,
        source: 'plaid',
      },
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: plan.id,
      date: '2026-10-01',
      quantity: 1,
      price: 20,
      source: 'plaid',
    });
    await prisma.investmentTransaction.create({
      data: {
        accountId: a.id,
        securityId: plan.id,
        date: day('2026-10-01'),
        type: 'buy',
        subtype: 'buy',
        name: 'Test buy',
        quantity: 1,
        amount: 20,
        currency: 'USD',
        source: 'plaid',
      },
    });
    await seedBalance(prisma, a.id, '2026-10-01', 20, 'plaid');

    const first = await renameStoredSourceCodes(prisma);
    expect(first.map((c) => [c.column, c.from, c.to, c.renamed, c.dropped])).toEqual([
      ['Security.pricing', 'feed', 'market', 1, 0],
      ['Security.pricing', 'plaid', 'institution', 1, 0],
      ['SecurityPrice.source', 'yahoo', 'market', 1, 0],
      ['SecurityPrice.source', 'plaid', 'institution', 1, 0],
      ['SecurityEvent.source', 'yahoo', 'market', 1, 0],
      ['SecurityEvent.source', 'plaid', 'institution', 1, 0],
      ['HoldingSnapshot.source', 'plaid', 'synced', 1, 0],
      ['InvestmentTransaction.source', 'plaid', 'synced', 1, 0],
      ['AccountBalance.source', 'plaid', 'synced', 1, 0],
    ]);
    const pricing = async (id: string) =>
      (await prisma.security.findUniqueOrThrow({ where: { id } })).pricing;
    expect([await pricing(etf.id), await pricing(plan.id), await pricing(cash.id)]).toEqual([
      Pricing.Market,
      Pricing.Institution,
      Pricing.Fixed,
    ]);
    expect(
      (await prisma.securityPrice.findMany({ orderBy: { close: 'asc' } })).map((p) => p.source)
    ).toEqual([PriceSource.Market, PriceSource.Institution]);
    expect(
      (await prisma.securityEvent.findMany({ orderBy: { type: 'asc' } })).map((e) => e.source)
    ).toEqual([PriceSource.Market, PriceSource.Institution]);
    expect((await prisma.holdingSnapshot.findFirstOrThrow()).source).toBe(RecordSource.Synced);
    expect((await prisma.investmentTransaction.findFirstOrThrow()).source).toBe(
      RecordSource.Synced
    );
    expect((await prisma.accountBalance.findFirstOrThrow()).source).toBe(BalanceRowSource.Synced);

    const second = await renameStoredSourceCodes(prisma);
    expect(second).toHaveLength(first.length);
    expect(second.every((c) => c.renamed === 0 && c.dropped === 0)).toBe(true);
  });

  it('drops a legacy close that clashes with one already stored under the new code', async () => {
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: Pricing.Market });
    await seedPrice(prisma, etf.id, '2026-09-30', 9, 'yahoo');
    await seedPrice(prisma, etf.id, '2026-10-01', 10, 'yahoo');
    await seedPrice(prisma, etf.id, '2026-10-01', 11, PriceSource.Market);

    const counts = await renameStoredSourceCodes(prisma);
    expect(
      counts.find((c) => c.column === 'SecurityPrice.source' && c.from === 'yahoo')
    ).toMatchObject({ renamed: 1, dropped: 1 });
    expect(
      (await prisma.securityPrice.findMany({ orderBy: { date: 'asc' } })).map((p) => [
        isoDay(p.date),
        p.close,
        p.source,
      ])
    ).toEqual([
      ['2026-09-30', 9, PriceSource.Market],
      ['2026-10-01', 11, PriceSource.Market],
    ]);
  });
});

describe('ensureStoredCodes', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.resetModules();
  });

  it('renames once per process, with concurrent callers sharing one run', async () => {
    const { ensureStoredCodes } = await import('@/lib/investments/rename-stored-codes');
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: 'feed' });
    const run = vi.spyOn(prisma, '$transaction');
    const [a, b] = await Promise.all([ensureStoredCodes(prisma), ensureStoredCodes(prisma)]);
    expect(a).toBe(b);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await prisma.security.findUniqueOrThrow({ where: { id: etf.id } })).pricing).toBe(
      Pricing.Market
    );
    await ensureStoredCodes(prisma);
    expect(run).toHaveBeenCalledTimes(1);
    run.mockRestore();
  });

  it('lets the next caller retry after a failed run', async () => {
    const { ensureStoredCodes } = await import('@/lib/investments/rename-stored-codes');
    const run = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('database is locked'));
    await expect(ensureStoredCodes(prisma)).rejects.toThrow('database is locked');
    await expect(ensureStoredCodes(prisma)).resolves.toHaveLength(9);
    expect(run).toHaveBeenCalledTimes(2);
    run.mockRestore();
  });

  it('loads no new-code closes when no close is under an old code', async () => {
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: Pricing.Market });
    await seedPrice(prisma, etf.id, '2026-10-01', 11, PriceSource.Market);
    const sourcesQueried: string[] = [];
    // Records the `source` of every securityPrice.findMany the rename makes in its transaction.
    const watchTx = (tx: Prisma.TransactionClient) =>
      new Proxy(tx, {
        get: (target, prop, receiver) => {
          if (prop !== 'securityPrice') return Reflect.get(target, prop, receiver);
          return new Proxy(target.securityPrice, {
            get: (model, method, r) => {
              if (method !== 'findMany') return Reflect.get(model, method, r);
              return (args: Prisma.SecurityPriceFindManyArgs) => {
                sourcesQueried.push(String((args.where?.source as string) ?? ''));
                return model.findMany(args);
              };
            },
          });
        },
      });
    const watched = new Proxy(prisma, {
      get: (target, prop, receiver) =>
        prop === '$transaction'
          ? (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: object) =>
              target.$transaction((tx) => fn(watchTx(tx)), opts)
          : Reflect.get(target, prop, receiver),
    });

    await renameStoredSourceCodes(watched);

    expect(sourcesQueried).toEqual(['yahoo', 'plaid']);
  });
});
