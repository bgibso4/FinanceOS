import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createTransactionData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import {
  exportDatabase,
  importDatabase,
  generateChecksum,
  setPrismaClient,
  resetPrismaClient,
} from '@/lib/cloud-sync/sync';

describe('cloud-sync splitwise', () => {
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

  async function seed() {
    const account = await prisma.account.create({ data: createAccountData() });
    const tx = await prisma.transaction.create({ data: createTransactionData(account.id) });
    const fields = { accountId: account.id, group: 'trip', date: '2026-02-13', cost: 120 };
    const linked = await prisma.splitwiseRow.create({
      data: {
        ...fields,
        description: 'Dinner',
        amount: -30,
        status: 'imported',
        transactionId: tx.id,
      },
    });
    const skipped = await prisma.splitwiseRow.create({
      data: { ...fields, description: 'Taxi', amount: -10, status: 'skipped' },
    });
    const imp = await prisma.splitwiseImport.create({
      data: {
        accountId: account.id,
        group: 'trip',
        fileName: 'trip_2026-11-08_export.csv',
        person: 'Me',
        result: '{"counts":{}}',
        undo: '{"createdIds":[]}',
      },
    });
    return { linked, skipped, imp };
  }

  it('splitwiseTablesSurviveSyncRoundTrip', async () => {
    const { linked, skipped, imp } = await seed();

    const payload = await exportDatabase();
    expect(payload.metadata.recordCounts.splitwiseImports).toBe(1);
    expect(payload.metadata.recordCounts.splitwiseRows).toBe(2);
    await importDatabase(payload);

    expect(await prisma.splitwiseRow.findMany({ orderBy: { description: 'asc' } })).toEqual([
      linked,
      skipped,
    ]);
    expect(await prisma.splitwiseImport.findMany()).toEqual([imp]);
  });

  /** A payload as a build from before the Splitwise import would have written it. */
  async function oldPayload() {
    const payload = await exportDatabase();
    const data = { ...payload.data } as Record<string, unknown>;
    delete data.splitwiseImports;
    delete data.splitwiseRows;
    const oldData = data as typeof payload.data;
    return {
      ...payload,
      data: oldData,
      metadata: { ...payload.metadata, checksum: await generateChecksum(oldData) },
    };
  }

  it('payloadWithoutSplitwiseKeepsLocalRows', async () => {
    const { linked, imp } = await seed();
    const old = await oldPayload();

    await expect(importDatabase(old)).rejects.toThrow('older FinanceOS version');

    expect(await prisma.splitwiseRow.count()).toBe(2);
    expect(
      (await prisma.splitwiseRow.findUnique({ where: { id: linked.id } }))?.transactionId
    ).toBe(linked.transactionId);
    expect((await prisma.splitwiseImport.findMany()).map((i) => i.id)).toEqual([imp.id]);
  });

  it('payloadWithoutSplitwiseImportsWhenThereAreNoLocalRows', async () => {
    await prisma.account.create({ data: createAccountData() });
    const old = await oldPayload();

    await importDatabase(old);

    expect(await prisma.account.count()).toBe(1);
  });
});
