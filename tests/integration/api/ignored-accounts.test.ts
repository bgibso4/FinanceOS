import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { GET, POST, DELETE } from '@/app/api/ignored-accounts/route';

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
}

describe('ignored-accounts API', () => {
  let prisma: PrismaClient;

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
  });

  it('creates an ignore record', async () => {
    const res = await POST(
      jsonRequest('http://localhost/api/ignored-accounts', 'POST', {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_new_card',
        lastFour: '4242',
        name: 'Amazon Prime Card',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored.externalAccountId).toBe('acc_new_card');

    const rows = await prisma.ignoredBankAccount.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].lastFour).toBe('4242');
  });

  it('is idempotent when the same account is ignored twice', async () => {
    const payload = {
      provider: 'teller',
      institutionId: 'chase',
      externalAccountId: 'acc_new_card',
      lastFour: '4242',
    };

    await POST(jsonRequest('http://localhost/api/ignored-accounts', 'POST', payload));
    const res = await POST(jsonRequest('http://localhost/api/ignored-accounts', 'POST', payload));

    expect(res.status).toBe(200);
    expect(await prisma.ignoredBankAccount.count()).toBe(1);
  });

  it('lists ignore records', async () => {
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'plaid',
        institutionId: 'ins_1',
        externalAccountId: 'acc_1',
        lastFour: '1111',
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(body.ignored).toHaveLength(1);
    expect(body.ignored[0].provider).toBe('plaid');
  });

  it('deletes an ignore record by id', async () => {
    const row = await prisma.ignoredBankAccount.create({
      data: {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_1',
        lastFour: '1111',
      },
    });

    const res = await DELETE(
      jsonRequest(`http://localhost/api/ignored-accounts?id=${row.id}`, 'DELETE')
    );

    expect(res.status).toBe(200);
    expect(await prisma.ignoredBankAccount.count()).toBe(0);
  });

  it('rejects a request with no id on delete', async () => {
    const res = await DELETE(jsonRequest('http://localhost/api/ignored-accounts', 'DELETE'));
    expect(res.status).toBe(400);
  });
});
