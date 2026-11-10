import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createCategoryData } from '../../helpers/factories';
import { SplitwiseStore } from '@/lib/splitwise/store';
import {
  SplitwiseImporter,
  SplitwiseNotFoundError,
  SplitwiseUndoError,
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
  TRIP_PAIR,
  withLine,
} from './fixtures';

/** A store whose import delete, the last write of an undo, throws. */
class FailingDeleteStore extends SplitwiseStore {
  protected override bind(db: Prisma.TransactionClient): SplitwiseStore {
    return new FailingDeleteStore(db);
  }

  override async deleteImport(): Promise<void> {
    throw new Error('disk full');
  }
}

const STAY_2_EDITED = '2026-10-10,Rental stay 2,Hotel,1000.00,USD,500.00,-500.00';
const NEW_DINNER = '2026-10-12,New dinner,Dining out,40.00,USD,20.00,-20.00';

describe('SplitwiseImporter restore and undo', () => {
  let prisma: PrismaClient;
  let importer: SplitwiseImporter;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    importer = createSplitwiseImporter({ prisma });
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    ({ accountId } = await seedSplitwise(prisma));
  });

  const tripPair = (text = fixture(TRIP_PAIR)): RunInput => ({
    accountId,
    person: 'Me',
    fileName: TRIP_PAIR,
    text,
  });
  const without = (line: string) => tripPair(withLine(fixture(TRIP_PAIR), line, null));
  /** Stay 1 edited, stay 2 deleted, a new dinner added. */
  const editDeleteAndAdd = () =>
    tripPair(withLine(withLine(fixture(TRIP_PAIR), STAY_1, STAY_1_EDITED), STAY_2, NEW_DINNER));

  const txByMerchant = (merchant: string) =>
    prisma.transaction.findFirstOrThrow({ where: { accountId, merchant } });
  const rowByDescription = (description: string) =>
    prisma.splitwiseRow.findFirstOrThrow({ where: { description } });
  const newTrip = () =>
    prisma.trip.create({ data: { name: 'Coast', startDate: '2026-10-01', endDate: '2026-11-01' } });

  /** Everything restore and undo write; rows without createdAt, which undo doesn't keep. */
  const state = async () => ({
    transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
    rows: (await prisma.splitwiseRow.findMany({ orderBy: { id: 'asc' } })).map(
      ({ createdAt: _createdAt, ...r }) => r
    ),
    imports: await prisma.splitwiseImport.findMany({ orderBy: { id: 'asc' } }),
  });

  describe('restore', () => {
    it('restoreRecreatesAsItWas', async () => {
      await importer.run(tripPair());
      const trip = await newTrip();
      const stay2 = await prisma.transaction.update({
        where: { id: (await txByMerchant('Rental stay 2')).id },
        data: { tripId: trip.id, tags: '["coast"]', note: 'ocean view' },
      });
      const second = await importer.run(without(STAY_2));
      const { rowId } = second.deleted[0];

      const result = await importer.restore(second.importId, rowId);

      expect(await prisma.transaction.findUnique({ where: { id: stay2.id } })).toEqual(stay2);
      expect(await rowByDescription('Rental stay 2')).toMatchObject({
        id: rowId,
        status: 'kept',
        transactionId: stay2.id,
        date: '2026-10-10',
        cost: 950,
        amount: -475,
      });
      expect(result.deleted).toEqual([{ ...second.deleted[0], restored: true }]);
      expect((await importer.result(second.importId)).deleted[0].restored).toBe(true);
    });

    it('restoreNullsCategoryAndTripDeletedSince', async () => {
      await importer.run(tripPair());
      const trip = await newTrip();
      const spa = await prisma.category.create({ data: createCategoryData({ name: 'Spa' }) });
      const stay2 = await prisma.transaction.update({
        where: { id: (await txByMerchant('Rental stay 2')).id },
        data: { tripId: trip.id, categoryId: spa.id },
      });
      const second = await importer.run(without(STAY_2));
      await prisma.trip.delete({ where: { id: trip.id } });
      await prisma.category.delete({ where: { id: spa.id } });

      await importer.restore(second.importId, second.deleted[0].rowId);

      expect(await prisma.transaction.findUnique({ where: { id: stay2.id } })).toEqual({
        ...stay2,
        tripId: null,
        categoryId: null,
      });
    });

    it('restoredRowSurvivesReimport', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));
      await importer.restore(second.importId, second.deleted[0].rowId);

      const third = await importer.run(without(STAY_2));

      expect(third.counts).toMatchObject({ deleted: 0, unchanged: 7, new: 0 });
      expect(third.deleted).toEqual([]);
      const stay2 = await txByMerchant('Rental stay 2');
      expect(stay2).toMatchObject({ amount: -475 });
      expect(await prisma.transaction.count()).toBe(8);
      expect(await rowByDescription('Rental stay 2')).toMatchObject({
        status: 'kept',
        transactionId: stay2.id,
      });
    });

    it('keptRowThatReappearsIsUnchanged', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));
      await importer.restore(second.importId, second.deleted[0].rowId);
      await importer.run(without(STAY_2));

      const back = await importer.run(tripPair());

      expect(back.counts).toMatchObject({ new: 0, deleted: 0, changed: 0, unchanged: 8 });
      expect(await prisma.transaction.count()).toBe(8);
      expect(await prisma.splitwiseRow.count()).toBe(8);
      expect(await rowByDescription('Rental stay 2')).toMatchObject({ status: 'kept' });
    });

    it('editOfKeptRowUpdatesAmountAndIsUndoable', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));
      await importer.restore(second.importId, second.deleted[0].rowId);
      const stay2Id = (await txByMerchant('Rental stay 2')).id;

      const edited = await importer.run(
        tripPair(withLine(fixture(TRIP_PAIR), STAY_2, STAY_2_EDITED))
      );

      expect(edited.counts).toMatchObject({ changed: 1, new: 0, deleted: 0 });
      expect(await prisma.transaction.findUnique({ where: { id: stay2Id } })).toMatchObject({
        amount: -500,
      });
      expect(await rowByDescription('Rental stay 2')).toMatchObject({
        status: 'kept',
        transactionId: stay2Id,
        amount: -500,
      });

      await importer.undo(edited.importId);

      expect(await prisma.transaction.findUnique({ where: { id: stay2Id } })).toMatchObject({
        amount: -475,
      });
      expect(await rowByDescription('Rental stay 2')).toMatchObject({
        status: 'kept',
        amount: -475,
      });
    });

    it('keptRowDeletedByYouIsIgnoredAndNeverRecreated', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));
      await importer.restore(second.importId, second.deleted[0].rowId);
      await prisma.transaction.delete({ where: { id: (await txByMerchant('Rental stay 2')).id } });

      const back = await importer.run(tripPair());

      expect(back.counts).toMatchObject({ ignored: 1, new: 0, unchanged: 7 });
      expect(await rowByDescription('Rental stay 2')).toMatchObject({
        status: 'dismissed',
        transactionId: null,
      });

      const edited = await importer.run(
        tripPair(withLine(fixture(TRIP_PAIR), STAY_2, STAY_2_EDITED))
      );

      expect(edited.counts).toMatchObject({ ignored: 1, new: 0, changed: 0 });
      expect(
        await prisma.transaction.findFirst({ where: { merchant: 'Rental stay 2' } })
      ).toBeNull();
    });

    it('restoreRefusedWhenNotLatest', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));
      await importer.run(without(STAY_2));
      const before = await state();

      await expect(importer.restore(second.importId, second.deleted[0].rowId)).rejects.toThrow(
        SplitwiseUndoError
      );

      expect(await state()).toEqual(before);
    });

    it('restoreTwiceChangesNothing', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));
      await importer.restore(second.importId, second.deleted[0].rowId);
      const before = await state();

      const result = await importer.restore(second.importId, second.deleted[0].rowId);

      expect(result.deleted[0].restored).toBe(true);
      expect(await state()).toEqual(before);
    });

    it('restoreOfUnknownImportOrRowIsNotFound', async () => {
      await importer.run(tripPair());
      const second = await importer.run(without(STAY_2));

      await expect(importer.restore('no-such-import', second.deleted[0].rowId)).rejects.toThrow(
        SplitwiseNotFoundError
      );
      await expect(importer.restore(second.importId, 'no-such-row')).rejects.toThrow(
        SplitwiseNotFoundError
      );
    });
  });

  describe('undo', () => {
    it('undoRevertsCreatesEditsAndDeletes', async () => {
      await importer.run(tripPair());
      const before = await state();
      const second = await importer.run(editDeleteAndAdd());
      expect(second.counts).toMatchObject({ new: 1, changed: 1, deleted: 1 });
      const trip = await newTrip();
      const groceries = await prisma.category.findFirstOrThrow({ where: { name: '🛒 Groceries' } });
      await prisma.transaction.update({
        where: { id: (await txByMerchant('New dinner')).id },
        data: { categoryId: groceries.id, tripId: trip.id, note: 'lost' },
      });
      const stay1 = await prisma.transaction.update({
        where: { id: (await txByMerchant('Rental stay 1')).id },
        data: { categoryId: groceries.id, tripId: trip.id },
      });

      await importer.undo(second.importId);

      expect(await state()).toEqual({
        ...before,
        transactions: before.transactions.map((t) =>
          t.id === stay1.id ? { ...t, categoryId: groceries.id, tripId: trip.id } : t
        ),
      });
    });

    it('undoForgetsTheImport', async () => {
      const first = await importer.run(without(STAY_1));
      const second = await importer.run(tripPair());

      await importer.undo(second.importId);

      await expect(importer.result(second.importId)).rejects.toThrow(SplitwiseNotFoundError);
      expect((await importer.result(first.importId)).canUndo).toBe(true);
      const again = await importer.run(tripPair());
      expect(again.firstImport).toBe(false);
      expect(again.counts).toEqual(second.counts);

      await importer.undo(again.importId);
      await importer.undo(first.importId);

      expect(await state()).toEqual({ transactions: [], rows: [], imports: [] });
      expect((await importer.run(tripPair())).firstImport).toBe(true);
    });

    it('undoRefusedWhenNotLatest', async () => {
      const first = await importer.run(without(STAY_1));
      await importer.run(tripPair());
      const before = await state();

      await expect(importer.undo(first.importId)).rejects.toThrow(SplitwiseUndoError);
      await expect(importer.undo('no-such-import')).rejects.toThrow(SplitwiseNotFoundError);

      expect(await state()).toEqual(before);
    });

    it('undoIsAllOrNothing', async () => {
      await importer.run(tripPair());
      const second = await importer.run(editDeleteAndAdd());
      const before = await state();
      const failing = new SplitwiseImporter(
        new FailingDeleteStore(prisma),
        splitwiseCategoriser(prisma)
      );

      await expect(failing.undo(second.importId)).rejects.toThrow('disk full');

      expect(await state()).toEqual(before);
    });

    it('undoKeepsRowWhoseTransactionYouDeletedSince', async () => {
      await importer.run(tripPair());
      const second = await importer.run(
        tripPair(withLine(fixture(TRIP_PAIR), STAY_1, STAY_1_EDITED))
      );
      await prisma.transaction.delete({
        where: { id: (await txByMerchant('Rental stay 2')).id },
      });

      await importer.undo(second.importId);

      expect(await txByMerchant('Rental stay 1')).toMatchObject({ amount: -280 });
      expect(await rowByDescription('Rental stay 2')).toMatchObject({
        status: 'imported',
        transactionId: null,
      });
      const again = await importer.run(tripPair());
      expect(again.counts).toMatchObject({ new: 0, ignored: 1, unchanged: 7 });
    });

    it('undoRecreatesDeletedWithoutTripDeletedSince', async () => {
      await importer.run(tripPair());
      const trip = await newTrip();
      const stay2 = await prisma.transaction.update({
        where: { id: (await txByMerchant('Rental stay 2')).id },
        data: { tripId: trip.id },
      });
      const second = await importer.run(without(STAY_2));
      await prisma.trip.delete({ where: { id: trip.id } });

      await importer.undo(second.importId);

      expect(await prisma.transaction.findUnique({ where: { id: stay2.id } })).toEqual({
        ...stay2,
        tripId: null,
      });
    });

    it('undoKeepsWhatWasRestored', async () => {
      await importer.run(tripPair());
      const before = await state();
      const second = await importer.run(without(STAY_2));
      await importer.restore(second.importId, second.deleted[0].rowId);

      await importer.undo(second.importId);

      expect(await state()).toEqual(before);
    });
  });
});
