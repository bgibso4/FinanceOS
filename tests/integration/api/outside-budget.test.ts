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

import { PATCH } from '@/app/api/transactions/[id]/route';
import { POST as bulkPost } from '@/app/api/transactions/bulk/route';

const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

describe('outside-budget flag API', () => {
  let accountId: string;

  const makeTx = async (data: { isTransfer?: boolean; isOutsideBudget?: boolean } = {}) =>
    testPrisma.transaction.create({ data: { ...createTransactionData(accountId), ...data } });
  const reload = (id: string) => testPrisma.transaction.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    const account = createAccountData({ id: 'ob-account' });
    await testPrisma.account.create({ data: account });
    accountId = account.id!;
  });

  it('setsTheFlag', async () => {
    const tx = await makeTx();
    const res = await patch(tx.id, { isOutsideBudget: true });
    expect(res.status).toBe(200);
    expect((await reload(tx.id)).isOutsideBudget).toBe(true);
  });

  it('transferClearsIt', async () => {
    const tx = await makeTx({ isOutsideBudget: true });
    const res = await patch(tx.id, { isTransfer: true });
    expect(res.status).toBe(200);
    expect(await reload(tx.id)).toMatchObject({ isTransfer: true, isOutsideBudget: false });
  });

  it('refusesBothInOneRequest', async () => {
    const tx = await makeTx();
    const res = await patch(tx.id, { isTransfer: true, isOutsideBudget: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A transfer can't be outside budget" });
    expect(await reload(tx.id)).toMatchObject({ isTransfer: false, isOutsideBudget: false });
  });

  it('refusesTickingATransfer', async () => {
    const tx = await makeTx({ isTransfer: true });
    const res = await patch(tx.id, { isOutsideBudget: true });
    expect(res.status).toBe(400);
    expect((await reload(tx.id)).isOutsideBudget).toBe(false);
  });

  it('untransferAndTickTogether', async () => {
    const tx = await makeTx({ isTransfer: true });
    const res = await patch(tx.id, { isTransfer: false, isOutsideBudget: true });
    expect(res.status).toBe(200);
    expect(await reload(tx.id)).toMatchObject({ isTransfer: false, isOutsideBudget: true });
  });

  it('bulkTransferClearsIt', async () => {
    const a = await makeTx({ isOutsideBudget: true });
    const b = await makeTx({ isOutsideBudget: true });
    const res = await bulkPost(
      new NextRequest('http://localhost/api/transactions/bulk', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update',
          transactionIds: [a.id, b.id],
          data: { isTransfer: true },
        }),
      })
    );
    expect(res.status).toBe(200);
    for (const id of [a.id, b.id]) {
      expect(await reload(id)).toMatchObject({ isTransfer: true, isOutsideBudget: false });
    }
  });
});
