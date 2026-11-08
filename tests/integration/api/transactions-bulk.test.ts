import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createTransactionData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { POST } from '@/app/api/transactions/bulk/route';

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/transactions/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

describe('POST /api/transactions/bulk tripId', () => {
  let accountId: string;
  let tripId: string;

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    const account = createAccountData({ id: 'bulk-account' });
    await testPrisma.account.create({ data: account });
    accountId = account.id!;
    const trip = await testPrisma.trip.create({
      data: { name: 'Test Trip', startDate: '2026-01-01', endDate: '2026-01-05' },
    });
    tripId = trip.id;
  });

  it('bulkTripSkipsSplitParents', async () => {
    const plain = await testPrisma.transaction.create({ data: createTransactionData(accountId) });
    const parent = await testPrisma.transaction.create({
      data: { ...createTransactionData(accountId), isSplitParent: true },
    });

    const res = await post({
      action: 'update',
      transactionIds: [plain.id, parent.id],
      data: { tripId },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, affected: 1, skipped: 1 });
    expect(
      (await testPrisma.transaction.findUniqueOrThrow({ where: { id: plain.id } })).tripId
    ).toBe(tripId);
    expect(
      (await testPrisma.transaction.findUniqueOrThrow({ where: { id: parent.id } })).tripId
    ).toBeNull();
  });

  it('null tripId clears the trip, split parents included', async () => {
    const tx = await testPrisma.transaction.create({
      data: createTransactionData(accountId, { tripId }),
    });
    const res = await post({ action: 'update', transactionIds: [tx.id], data: { tripId: null } });
    expect(await res.json()).toMatchObject({ affected: 1, skipped: 0 });
    expect(
      (await testPrisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).tripId
    ).toBeNull();
  });
});
