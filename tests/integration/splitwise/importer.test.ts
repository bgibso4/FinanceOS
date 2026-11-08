import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Prisma, PrismaClient, Transaction } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createTransactionData,
} from '../../helpers/factories';
import { SplitwiseExportError } from '@/lib/splitwise/export';
import { SplitwiseStore } from '@/lib/splitwise/store';
import {
  SplitwiseConflictError,
  SplitwiseImporter,
  type Categoriser,
  type RunInput,
} from '@/lib/splitwise/importer';
import { splitwiseCategoriser } from '@/lib/splitwise/categories';
import { createSplitwiseImporter } from '@/lib/splitwise/services';
import {
  STAY_2,
  fixture,
  STAY_1,
  STAY_1_EDITED,
  seedSplitwise,
  TRIP_13,
  TRIP_PAIR,
  withLine,
} from './fixtures';

/** A store whose `nth` transaction create, in or out of a transaction, throws. */
class FailingStore extends SplitwiseStore {
  constructor(
    db: PrismaClient | Prisma.TransactionClient,
    private readonly calls: { n: number; nth: number }
  ) {
    super(db);
  }

  protected override bind(db: Prisma.TransactionClient): SplitwiseStore {
    return new FailingStore(db, this.calls);
  }

  override async createTransaction(
    data: Prisma.TransactionUncheckedCreateInput
  ): Promise<Transaction> {
    if (++this.calls.n === this.calls.nth) throw new Error('disk full');
    return super.createTransaction(data);
  }
}

/** A store that can't snapshot anything, as if each transaction vanished just before. */
class VanishingStore extends SplitwiseStore {
  protected override bind(db: Prisma.TransactionClient): SplitwiseStore {
    return new VanishingStore(db);
  }

  override async snapshot(): Promise<null> {
    return null;
  }
}

describe('SplitwiseImporter', () => {
  let prisma: PrismaClient;
  let importer: SplitwiseImporter;
  let accountId: string;
  let lodging: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    importer = createSplitwiseImporter({ prisma });
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    ({ accountId, lodging } = await seedSplitwise(prisma));
  });

  const input = (fileName: string, overrides: Partial<RunInput> = {}): RunInput => ({
    accountId,
    person: 'Me',
    fileName,
    text: fixture(fileName),
    ...overrides,
  });

  /** trip-pair with `line` (a row's start) replaced by `replacement`, or removed when null. */
  const tripPairWith = (line: string, replacement: string | null) =>
    input(TRIP_PAIR, { text: withLine(fixture(TRIP_PAIR), line, replacement) });

  const txByMerchant = (merchant: string) =>
    prisma.transaction.findFirstOrThrow({ where: { accountId, merchant } });

  it('firstImportCreatesYourRowsOnly', async () => {
    const result = await importer.run(input(TRIP_13));

    const txs = await prisma.transaction.findMany({ where: { accountId } });
    expect(txs).toHaveLength(24);
    const transfers = txs.filter((t) => t.isTransfer);
    expect(transfers.map((t) => t.merchant).sort()).toEqual([
      'Me paid Person A',
      'Me paid Person F',
    ]);
    for (const t of transfers) {
      expect(t).toMatchObject({ categoryId: null, confidenceScore: 1, transferGroupId: null });
    }
    expect(result).toMatchObject({
      group: 'trip-13',
      fileName: TRIP_13,
      firstImport: true,
      canUndo: true,
      total: 0,
      counts: { new: 24, payments: 2, changed: 0, deleted: 0, unchanged: 0, others: 16 },
    });
    expect(result.others).toHaveLength(16);
    expect(result.others[0]).toEqual({ date: '2026-09-08', description: 'Cover charge', cost: 80 });
    expect(result.notes).toHaveLength(24);
    expect(result.notes.filter((n) => n.kind === 'payment')).toHaveLength(2);
    expect(result.transactions).toHaveLength(24);
    const dates = result.transactions.map((t) => t.date.toISOString());
    expect(dates).toEqual([...dates].sort().reverse());
    expect(await prisma.splitwiseRow.count({ where: { status: 'imported' } })).toBe(24);
  });

  it('amountsAreYourColumn', async () => {
    await importer.run(input(TRIP_13));

    expect(await txByMerchant('Villa deposit')).toMatchObject({
      amount: -184.62,
      date: new Date('2026-09-08T00:00:00.000Z'),
    });
    expect(await txByMerchant('Me paid Person F')).toMatchObject({ amount: 1731.13 });
    const ubers = await prisma.transaction.findMany({
      where: { accountId, merchant: 'Rideshare', date: new Date('2026-09-08T00:00:00.000Z') },
    });
    expect(ubers.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-17.92, -5.42, 151.99]);
    expect(await txByMerchant('Groceries day 1')).toMatchObject({ amount: -25.5 });
  });

  it('skipBeforeRemembersSkipped', async () => {
    const first = await importer.run(input(TRIP_PAIR, { skipBefore: '2026-11-08' }));

    expect(await prisma.transaction.findMany({ where: { accountId } })).toEqual([
      expect.objectContaining({ merchant: 'Me paid Person A', isTransfer: true }),
    ]);
    expect(first.counts).toMatchObject({ new: 1, payments: 1, skippedByDate: 7 });
    expect(await prisma.splitwiseRow.count({ where: { status: 'skipped' } })).toBe(7);

    const again = await importer.run(input(TRIP_PAIR));

    expect(await prisma.transaction.count()).toBe(1);
    expect(again.firstImport).toBe(false);
    expect(again.counts).toMatchObject({ new: 0, skippedByDate: 0, unchanged: 8 });
  });

  it('skipBeforeAppliesToFirstImportOnly', async () => {
    await importer.run(tripPairWith(STAY_1, null));

    const again = await importer.run(input(TRIP_PAIR, { skipBefore: '2026-11-08' }));

    expect(again.counts).toMatchObject({ new: 1, skippedByDate: 0 });
    expect(await txByMerchant('Rental stay 1')).toMatchObject({ amount: -280 });
  });

  it('reimportSameFileCreatesNothing', async () => {
    await importer.run(input(TRIP_13));

    const again = await importer.run(input(TRIP_13));

    expect(await prisma.transaction.count()).toBe(24);
    expect(await prisma.splitwiseRow.count()).toBe(24);
    expect(again.counts).toEqual({
      new: 0,
      payments: 0,
      changed: 0,
      deleted: 0,
      unchanged: 24,
      skippedByDate: 0,
      others: 16,
      otherCurrency: 0,
      ignored: 0,
      needCategory: 0,
    });
    expect(again.notes).toEqual([]);
    expect(again.transactions).toEqual([]);
  });

  it('editKeepsCategoryTripTagsNote', async () => {
    await importer.run(input(TRIP_PAIR));
    const trip = await prisma.trip.create({
      data: { name: 'Coast', startDate: '2026-10-01', endDate: '2026-11-01' },
    });
    const groceries = await prisma.category.findFirstOrThrow({ where: { name: '🛒 Groceries' } });
    const stay1 = await prisma.transaction.update({
      where: { id: (await txByMerchant('Rental stay 1')).id },
      data: { categoryId: groceries.id, tripId: trip.id, tags: '["coast"]', note: 'ocean view' },
    });

    const result = await importer.run(tripPairWith(STAY_1, STAY_1_EDITED));

    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: stay1.id } })).toMatchObject({
      amount: -300,
      date: new Date('2026-10-10T00:00:00.000Z'),
      categoryId: groceries.id,
      tripId: trip.id,
      tags: '["coast"]',
      note: 'ocean view',
    });
    expect(result.counts).toMatchObject({ changed: 1, new: 0, unchanged: 7 });
    expect(result.notes).toEqual([
      { transactionId: stay1.id, kind: 'changed', was: -280, cost: 600, category: 'Hotel' },
    ]);
    expect(result.transactions.map((t) => t.id)).toEqual([stay1.id]);
    expect((await importer.run(tripPairWith(STAY_1, STAY_1_EDITED))).counts).toMatchObject({
      changed: 0,
      unchanged: 8,
    });
  });

  it('editWithoutSnapshotFailsRatherThanLosingUndo', async () => {
    await importer.run(input(TRIP_PAIR));
    const vanishing = new SplitwiseImporter(
      new VanishingStore(prisma),
      splitwiseCategoriser(prisma)
    );

    const run = vanishing.run(tripPairWith(STAY_1, STAY_1_EDITED));
    await expect(run).rejects.toThrow(SplitwiseConflictError);
    await expect(run).rejects.toThrow('Rental stay 1');

    expect(await txByMerchant('Rental stay 1')).toMatchObject({ amount: -280 });
    expect(await prisma.splitwiseImport.count()).toBe(1);
  });

  it('splitTransactionEditIsFlagged', async () => {
    await importer.run(input(TRIP_PAIR));
    const stay1 = await txByMerchant('Rental stay 1');
    await prisma.transaction.update({ where: { id: stay1.id }, data: { isSplitParent: true } });

    const result = await importer.run(tripPairWith(STAY_1, STAY_1_EDITED));

    expect(await txByMerchant('Rental stay 1')).toMatchObject({ amount: -280 });
    expect(result.notes).toEqual([
      {
        transactionId: stay1.id,
        kind: 'changed',
        was: -280,
        cost: 600,
        category: 'Hotel',
        flag: 'check-split',
      },
    ]);
    expect(result.counts.changed).toBe(1);
    const again = await importer.run(tripPairWith(STAY_1, STAY_1_EDITED));
    expect(again.notes).toEqual([]);
    expect(again.counts.unchanged).toBe(8);
  });

  it('deletionRemovesAndListsIt', async () => {
    await importer.run(input(TRIP_PAIR));
    const stay2 = await txByMerchant('Rental stay 2');
    expect(stay2.categoryId).toBe(lodging);

    const result = await importer.run(tripPairWith(STAY_2, null));

    expect(await prisma.transaction.findUnique({ where: { id: stay2.id } })).toBeNull();
    expect(result.counts).toMatchObject({ deleted: 1, unchanged: 7 });
    expect(result.deleted).toEqual([
      {
        rowId: expect.any(String),
        date: '2026-10-10',
        description: 'Rental stay 2',
        amount: -475,
        category: '🏘️ Lodging',
        restored: false,
      },
    ]);
    expect(await prisma.splitwiseRow.count()).toBe(7);
  });

  it('reshapedDeletionIsFlaggedAndKept', async () => {
    await importer.run(input(TRIP_PAIR));
    const stay2 = await txByMerchant('Rental stay 2');
    await prisma.transaction.update({
      where: { id: stay2.id },
      data: { isTransfer: true, transferGroupId: 'pair-1' },
    });

    const result = await importer.run(tripPairWith(STAY_2, null));

    expect(await prisma.transaction.findUnique({ where: { id: stay2.id } })).not.toBeNull();
    expect(result.deleted).toEqual([]);
    expect(result.counts.deleted).toBe(1);
    expect(result.notes).toEqual([
      {
        transactionId: stay2.id,
        kind: 'changed',
        cost: 950,
        category: '',
        flag: 'deleted-check',
      },
    ]);
    expect(await prisma.splitwiseRow.count()).toBe(8);
  });

  it('deletedByYouIsNeverRecreated', async () => {
    await importer.run(input(TRIP_PAIR));
    await prisma.transaction.delete({ where: { id: (await txByMerchant('Rental stay 1')).id } });

    const again = await importer.run(input(TRIP_PAIR));

    expect(await prisma.transaction.count()).toBe(7);
    expect(again.counts).toMatchObject({ new: 0, ignored: 1, unchanged: 7 });
    expect(
      await prisma.splitwiseRow.findFirstOrThrow({ where: { description: 'Rental stay 1' } })
    ).toMatchObject({ status: 'dismissed', transactionId: null });
  });

  it('editOfDeletedByYouCreatesNothing', async () => {
    await importer.run(input(TRIP_PAIR));
    await prisma.transaction.delete({ where: { id: (await txByMerchant('Rental stay 1')).id } });

    const again = await importer.run(tripPairWith(STAY_1, STAY_1_EDITED));

    expect(await prisma.transaction.count()).toBe(7);
    expect(again.counts).toMatchObject({ new: 0, changed: 0, ignored: 1 });
    expect(again.notes).toEqual([]);
    expect(
      await prisma.splitwiseRow.findFirstOrThrow({ where: { description: 'Rental stay 1' } })
    ).toMatchObject({ status: 'dismissed', amount: -300, cost: 600 });
  });

  it('otherCurrencyCountedNotImported', async () => {
    const result = await importer.run(
      tripPairWith(STAY_1, '2026-10-10,Rental stay 1,Hotel,560.00,EUR,280.00,-280.00')
    );

    expect(result.counts).toMatchObject({ new: 7, otherCurrency: 1 });
    expect(await prisma.transaction.findFirst({ where: { merchant: 'Rental stay 1' } })).toBeNull();
    expect(await prisma.splitwiseRow.count()).toBe(7);
  });

  it('ruleBeatsFallbackAndFallbackMapsHotel', async () => {
    const groceries = await prisma.category.findFirstOrThrow({ where: { name: '🛒 Groceries' } });
    await prisma.rule.create({
      data: {
        conditions: JSON.stringify([
          { field: 'merchant', operator: 'contains', value: 'Rental stay 1' },
        ]),
        categoryId: groceries.id,
        renameTo: 'First stay',
      },
    });

    await importer.run(input(TRIP_PAIR));

    expect(await txByMerchant('First stay')).toMatchObject({
      categoryId: groceries.id,
      confidenceScore: 0.98,
      merchantNormalized: 'first stay',
    });
    expect(await txByMerchant('Hotel night 1 after credit')).toMatchObject({
      categoryId: lodging,
      confidenceScore: 0.72,
    });
  });

  it('fallbackMapsTaxiAndGroceriesToEmojiNamedCategories', async () => {
    await importer.run(input(TRIP_13));

    const rideshare = await prisma.category.findFirstOrThrow({
      where: { name: '🚙 Rideshare (Uber/Lyft/etc.)' },
    });
    const groceries = await prisma.category.findFirstOrThrow({ where: { name: '🛒 Groceries' } });
    expect(await txByMerchant('Rides + drinks delivery')).toMatchObject({
      categoryId: rideshare.id,
    });
    expect(await txByMerchant('Groceries day 1')).toMatchObject({
      categoryId: groceries.id,
      confidenceScore: 0.72,
    });
  });

  it.each([
    ['Entertainment - Other', 'entertainment'],
    ['Movies', 'entertainment'],
    ['Music', 'entertainment'],
    ['Games', 'entertainment'],
    ['Sports', 'sports'],
  ])('fallbackMapsEntertainmentSubcategory %s', async (category, expected) => {
    const ids = {
      entertainment: (
        await prisma.category.create({ data: createCategoryData({ name: '🎭 Entertainment' }) })
      ).id,
      sports: (await prisma.category.create({ data: createCategoryData({ name: '⚽ Sports' }) }))
        .id,
    };
    const row = {
      date: '2026-10-10',
      description: 'Night out',
      category,
      cost: 20,
      currency: 'USD',
      amount: -10,
    };

    expect(await splitwiseCategoriser(prisma)(row, accountId)).toEqual({
      categoryId: ids[expected as keyof typeof ids],
      confidence: 0.72,
      merchant: 'Night out',
    });
  });

  it('unmatchedCategoryCountsNeedCategory', async () => {
    const result = await importer.run(input(TRIP_PAIR));

    // The three General rows; the hotels map to Lodging and the payment needs none.
    expect(result.counts.needCategory).toBe(3);
    expect(await txByMerchant('Other shared costs')).toMatchObject({
      categoryId: null,
      confidenceScore: 0.3,
    });
  });

  describe('failureMidImportWritesNothing', () => {
    const expectNothingWritten = async () => {
      expect(await prisma.transaction.count()).toBe(0);
      expect(await prisma.splitwiseRow.count()).toBe(0);
      expect(await prisma.splitwiseImport.count()).toBe(0);
    };

    it('whenTheThirdTransactionWriteFails', async () => {
      const failing = new SplitwiseImporter(
        new FailingStore(prisma, { n: 0, nth: 3 }),
        splitwiseCategoriser(prisma)
      );

      await expect(failing.run(input(TRIP_13))).rejects.toThrow('disk full');

      await expectNothingWritten();
    });

    it('whenTheCategoriserThrowsOnTheThirdRow', async () => {
      let calls = 0;
      const categorise: Categoriser = async (row) => {
        if (++calls === 3) throw new Error('rules unreadable');
        return { categoryId: null, confidence: 0.3, merchant: row.description };
      };
      const failing = new SplitwiseImporter(new SplitwiseStore(prisma), categorise);

      await expect(failing.run(input(TRIP_13))).rejects.toThrow('rules unreadable');

      await expectNothingWritten();
    });

    it('keepsEarlierImportIntactWhenAReimportFails', async () => {
      await importer.run(input(TRIP_PAIR));
      await prisma.transaction.delete({ where: { id: (await txByMerchant('Rental stay 1')).id } });
      const failing = new SplitwiseImporter(
        new FailingStore(prisma, { n: 0, nth: 1 }),
        splitwiseCategoriser(prisma)
      );

      await expect(
        failing.run(tripPairWith(STAY_2, '2026-10-12,New dinner,Dining out,40.00,USD,20.00,-20.00'))
      ).rejects.toThrow('disk full');

      expect(await prisma.transaction.count()).toBe(7);
      expect(await prisma.splitwiseImport.count()).toBe(1);
      expect(
        await prisma.splitwiseRow.findFirstOrThrow({ where: { description: 'Rental stay 1' } })
      ).toMatchObject({ status: 'imported', transactionId: null });
      expect(await txByMerchant('Rental stay 2')).toBeTruthy();
    });
  });

  it('importOfTheSameGroupMeanwhileIsRefusedNotDoubled', async () => {
    let racing = false;
    const real = splitwiseCategoriser(prisma);
    const categorise: Categoriser = async (row, id) => {
      if (!racing) {
        racing = true;
        await importer.run(input(TRIP_PAIR));
      }
      return real(row, id);
    };
    const slow = new SplitwiseImporter(new SplitwiseStore(prisma), categorise);

    await expect(slow.run(input(TRIP_PAIR))).rejects.toThrow(SplitwiseConflictError);

    expect(await prisma.transaction.count()).toBe(8);
    expect(await prisma.splitwiseImport.count()).toBe(1);
  });

  it('onlyTheChosenAccountIsWritten', async () => {
    const bank = await prisma.account.create({ data: createAccountData({ name: 'Checking' }) });
    const venmo = await prisma.transaction.create({
      data: createTransactionData(bank.id, {
        merchant: 'Venmo Person A',
        amount: -232.47,
        date: new Date('2026-11-08T00:00:00.000Z'),
      }),
    });

    await importer.run(input(TRIP_PAIR));

    expect(await prisma.transaction.findMany({ where: { accountId: bank.id } })).toEqual([venmo]);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(8);
    expect(await txByMerchant('Me paid Person A')).toMatchObject({
      isTransfer: true,
      transferGroupId: null,
    });
  });

  it('fileWithoutGroupInItsNameIsRejected', async () => {
    await expect(importer.run(input(TRIP_PAIR, { fileName: 'export.csv' }))).rejects.toThrow(
      SplitwiseExportError
    );
    expect(await prisma.splitwiseImport.count()).toBe(0);
  });

  it('resultRereadsTheImportAndCanUndoOnlyTheLatest', async () => {
    const first = await importer.run(input(TRIP_PAIR));
    const stay1 = await txByMerchant('Rental stay 1');
    await prisma.transaction.update({ where: { id: stay1.id }, data: { note: 'edited' } });

    const reread = await importer.run(input(TRIP_PAIR)).then(() => importer.result(first.importId));

    expect(reread).toMatchObject({
      importId: first.importId,
      group: 'trip-pair',
      createdAt: first.createdAt,
      canUndo: false,
      counts: first.counts,
      notes: first.notes,
    });
    expect(reread.transactions.find((t) => t.id === stay1.id)?.note).toBe('edited');
  });

  it('defaultsComeFromLastImportElseTheSplitwiseAccount', async () => {
    expect(await importer.defaults()).toEqual({ accountId, person: '', knownGroups: [] });

    await importer.run(input(TRIP_PAIR));
    await importer.run(input(TRIP_13));

    const defaults = await importer.defaults();
    expect(defaults).toMatchObject({ accountId, person: 'Me' });
    expect(defaults.knownGroups.sort()).toEqual(['trip-13', 'trip-pair']);
  });

  it('isKnownAfterAGroupsFirstImport', async () => {
    expect(await importer.isKnown(accountId, 'trip-pair')).toBe(false);

    await importer.run(input(TRIP_PAIR));

    expect(await importer.isKnown(accountId, 'trip-pair')).toBe(true);
    expect(await importer.isKnown(accountId, 'trip-13')).toBe(false);
  });
});
