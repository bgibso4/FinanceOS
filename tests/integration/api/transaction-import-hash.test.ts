import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { PATCH } from '@/app/api/transactions/[id]/route';
import { createImportHash } from '@/lib/sync-common';
import { normalizeMerchant } from '@/lib/categorization';

function patchRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/transactions/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('PATCH /api/transactions/[id] keeps importHash in step with the row', () => {
  let prisma: PrismaClient;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    testPrisma = prisma;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
    const account = await prisma.account.create({ data: createAccountData({ name: 'Checking' }) });
    accountId = account.id;
  });

  async function seedTransaction(amount = 82.05, merchant = 'Verizon') {
    const date = new Date('2026-08-05T00:00:00.000Z');
    return prisma.transaction.create({
      data: {
        accountId,
        date,
        amount,
        merchant,
        merchantNormalized: normalizeMerchant(merchant),
        importHash: createImportHash(accountId, date, amount, normalizeMerchant(merchant)),
        tags: '[]',
      },
    });
  }

  it('recomputes importHash when the amount is corrected', async () => {
    const tx = await seedTransaction(82.05);
    const before = tx.importHash;

    await PATCH(patchRequest({ amount: -82.05 }), params(tx.id));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(after.amount).toBe(-82.05);
    expect(after.importHash).not.toBe(before);
    // Must equal what a future sync of this same transaction would compute, or the
    // importHash dedup tier misses it and inserts a duplicate.
    expect(after.importHash).toBe(
      createImportHash(accountId, after.date, -82.05, after.merchantNormalized)
    );
  });

  it('recomputes importHash and merchantNormalized when the merchant is renamed', async () => {
    const tx = await seedTransaction(82.05, 'VERIZON WIRELESS 1234');

    await PATCH(patchRequest({ merchant: 'Verizon' }), params(tx.id));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(after.merchant).toBe('Verizon');
    expect(after.merchantNormalized).toBe(normalizeMerchant('Verizon'));
    expect(after.importHash).toBe(
      createImportHash(accountId, after.date, after.amount, normalizeMerchant('Verizon'))
    );
  });

  it('recomputes importHash when the date is corrected', async () => {
    const tx = await seedTransaction();
    const before = tx.importHash;

    await PATCH(patchRequest({ date: '2026-08-07' }), params(tx.id));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(after.importHash).not.toBe(before);
    expect(after.importHash).toBe(
      createImportHash(accountId, after.date, after.amount, after.merchantNormalized)
    );
  });

  it('leaves importHash alone when only metadata changes', async () => {
    const tx = await seedTransaction();
    const before = tx.importHash;

    await PATCH(patchRequest({ note: 'Phone bill', tags: ['utilities'] }), params(tx.id));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(after.note).toBe('Phone bill');
    expect(after.importHash).toBe(before);
  });
});
