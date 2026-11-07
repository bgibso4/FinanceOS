import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { GET } from '@/app/api/transactions/[id]/route';

const get = (id: string) =>
  GET(new NextRequest(`http://localhost/api/transactions/${id}`), {
    params: Promise.resolve({ id }),
  });

describe('GET /api/transactions/[id]', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    await testPrisma.account.create({
      data: createAccountData({ id: 'test-account', name: 'Test Account', currency: 'CAD' }),
    });
  });

  it('returns one transaction shaped like a list row, however old', async () => {
    await testPrisma.transaction.create({
      data: {
        id: 'test-old',
        date: new Date('2015-03-04T00:00:00.000Z'),
        amount: -42.5,
        merchant: 'Test Merchant',
        merchantNormalized: 'test merchant',
        accountId: 'test-account',
        tags: '["test-tag"]',
        importHash: 'test-hash',
      },
    });

    const res = await get('test-old');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'test-old',
      amount: -42.5,
      tags: ['test-tag'],
      account: { name: 'Test Account', currency: 'CAD' },
    });
  });

  it('answers 404 for a transaction that does not exist', async () => {
    const res = await get('test-missing');
    expect(res.status).toBe(404);
  });
});
