import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createTransactionData } from '../../helpers/factories';
import { SplitwiseStore } from '@/lib/splitwise/store';

describe('SplitwiseStore', () => {
  let prisma: PrismaClient;
  let store: SplitwiseStore;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    store = new SplitwiseStore(prisma);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    accountId = (await prisma.account.create({ data: createAccountData() })).id;
  });

  const row = (transactionId: string | null) => ({
    date: '2026-02-13',
    description: 'Friday Dinner',
    cost: 120,
    amount: -30,
    status: 'imported' as const,
    transactionId,
  });

  it('deletingTransactionBlanksRowLink', async () => {
    const tx = await store.createTransaction(createTransactionData(accountId));
    const created = await store.createRow(accountId, 'trip', row(tx.id));

    await store.deleteTransaction(tx.id);

    expect(await prisma.transaction.count()).toBe(0);
    expect(await store.rows(accountId, 'trip')).toEqual([{ ...created, transactionId: null }]);
  });

  it('deleteTransactionReleasesItsTransferPartnerInsideTheTransaction', async () => {
    const [a, b] = await Promise.all(
      [1, 2].map(() =>
        prisma.transaction.create({
          data: { ...createTransactionData(accountId), isTransfer: true, transferGroupId: 'g' },
        })
      )
    );

    await store.transaction((s) => s.deleteTransaction(a.id));

    expect(await prisma.transaction.findUnique({ where: { id: b.id } })).toMatchObject({
      isTransfer: false,
      transferGroupId: null,
    });
  });

  it('transactionRollsBackOnThrow', async () => {
    await expect(
      store.transaction(async (s) => {
        const tx = await s.createTransaction(createTransactionData(accountId));
        await s.createRow(accountId, 'trip', row(tx.id));
        await s.createImport({
          accountId,
          group: 'trip',
          fileName: 'trip_2026-11-08_export.csv',
          person: 'Me',
          result: { counts: {} },
          undo: { createdIds: [tx.id] },
        });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.splitwiseRow.count()).toBe(0);
    expect(await prisma.splitwiseImport.count()).toBe(0);
  });

  it('isReshapedCoversAllFourCases', async () => {
    const make = (data: object = {}) =>
      prisma.transaction.create({ data: { ...createTransactionData(accountId), ...data } });
    const plain = await make();
    const splitParent = await make({ isSplitParent: true });
    const transfer = await make({ transferGroupId: 'g' });
    const linked = await make({ linkedTransactionId: plain.id });
    const withOffset = await make();
    await make({ linkedTransactionId: withOffset.id });

    expect(await store.isReshaped(splitParent.id)).toBe(true);
    expect(await store.isReshaped(transfer.id)).toBe(true);
    expect(await store.isReshaped(linked.id)).toBe(true);
    expect(await store.isReshaped(withOffset.id)).toBe(true);
    const lonePlain = await make();
    expect(await store.isReshaped(lonePlain.id)).toBe(false);
  });

  it('snapshotRecreatesWithSameId', async () => {
    const category = await prisma.category.create({ data: { name: 'Dining', type: 'expense' } });
    const trip = await prisma.trip.create({
      data: { name: 'Trip', startDate: '2026-02-10', endDate: '2026-02-20' },
    });
    const tx = await prisma.transaction.create({
      data: {
        ...createTransactionData(accountId),
        categoryId: category.id,
        tripId: trip.id,
        tags: '["food"]',
        note: 'shared',
        confidenceScore: 1,
      },
    });
    const before = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });

    const snapshot = await store.snapshot(tx.id);
    // the snapshot goes into the import's undo JSON
    const stored = JSON.parse(JSON.stringify(snapshot));
    await store.deleteTransaction(tx.id);
    await store.recreate(stored);

    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).toEqual(before);
  });

  it('replaceRowsKeepsIdsAndOnlyTouchesTheGroup', async () => {
    await store.createRow(accountId, 'other', row(null));
    await store.createRow(accountId, 'trip', row(null));
    const kept = { ...row(null), id: 'row-1', status: 'kept' as const };

    await store.replaceRows(accountId, 'trip', [kept]);

    expect(await store.rows(accountId, 'trip')).toEqual([kept]);
    expect(await store.rows(accountId, 'other')).toHaveLength(1);
  });

  it('latestImportAndKnownGroupFollowTheNewestImport', async () => {
    const input = (fileName: string) => ({
      accountId,
      group: 'trip',
      fileName,
      person: 'Me',
      result: { fileName },
      undo: {},
    });
    expect(await store.knownGroup(accountId, 'trip')).toBe(false);
    const first = await store.createImport(input('a.csv'));
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.createImport(input('b.csv'));

    expect((await store.latestImport(accountId, 'trip'))?.id).toBe(second.id);
    expect((await store.latestImportAny())?.id).toBe(second.id);
    expect(await store.knownGroup(accountId, 'trip')).toBe(true);
    expect(await store.knownGroup(accountId, 'elsewhere')).toBe(false);

    await store.updateImportResult(first.id, { restored: true });
    expect((await store.getImport(first.id))?.result).toEqual({ restored: true });
    await store.deleteImport(second.id);
    expect((await store.latestImport(accountId, 'trip'))?.id).toBe(first.id);
  });

  it('splitwiseAccountIsTheActiveSplitwiseInstitution', async () => {
    expect(await store.splitwiseAccount()).toBeNull();
    await prisma.account.create({
      data: createAccountData({ institution: 'Splitwise', isActive: false }),
    });
    const live = await prisma.account.create({
      data: createAccountData({ institution: 'Splitwise', currency: 'CAD' }),
    });

    expect(await store.splitwiseAccount()).toEqual({ id: live.id, currency: 'CAD' });
    expect(await store.account(live.id)).toEqual({ id: live.id, currency: 'CAD' });
  });
});
