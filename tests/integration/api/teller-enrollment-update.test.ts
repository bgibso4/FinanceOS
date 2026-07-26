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

vi.mock('@/lib/teller', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/teller')>();
  return { ...original, tellerFetch: vi.fn() };
});

vi.mock('@/lib/encryption', () => ({
  encryptAccessToken: vi.fn(() => ({ encrypted: 'enc', iv: 'iv' })),
  decryptAccessToken: vi.fn(() => 'decrypted'),
}));

import { POST } from '@/app/api/teller/enrollment/update/route';
import { tellerFetch } from '@/lib/teller';

function tellerAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc_new_checking',
    enrollment_id: 'enr_new',
    institution: { id: 'chase', name: 'Chase' },
    name: 'Personal Checking',
    type: 'depository',
    subtype: 'checking',
    currency: 'USD',
    last_four: '3857',
    status: 'open',
    ...overrides,
  };
}

function updateRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/teller/enrollment/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('teller enrollment update API', () => {
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

  async function seedEnrollment(enrollmentId: string) {
    return prisma.tellerEnrollment.create({
      data: {
        enrollmentId,
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'old-enc',
        accessTokenIv: 'old-iv',
        status: 'connected',
      },
    });
  }

  async function seedConnection(
    enrollmentDbId: string,
    overrides: { tellerAccountId: string; lastFour: string; name: string; subtype?: string }
  ) {
    const acct = await prisma.account.create({
      data: createAccountData({ name: overrides.name }),
    });
    return prisma.tellerConnection.create({
      data: {
        accountId: acct.id,
        tellerEnrollmentId: enrollmentDbId,
        tellerAccountId: overrides.tellerAccountId,
        tellerAccountName: overrides.name,
        tellerAccountType: 'depository',
        tellerAccountSubtype: overrides.subtype ?? 'checking',
        tellerAccountLastFour: overrides.lastFour,
        status: 'connected',
      },
    });
  }

  it('refreshes the token in place when the same enrollment id returns', async () => {
    const enrollment = await seedEnrollment('enr_same');
    await seedConnection(enrollment.id, {
      tellerAccountId: 'acc_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_checking', last_four: '3857' }),
      tellerAccount({ id: 'acc_new_card', last_four: '4242', name: 'Amazon Card', type: 'credit' }),
    ]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_same', accessToken: 'fresh-token' }));
    const body = await res.json();

    expect(body.merged).toBe(false);
    expect(body.reconnected).toBe(1);
    expect(body.discovered).toHaveLength(1);
    expect(body.discovered[0].externalId).toBe('acc_new_card');

    const updated = await prisma.tellerEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(updated?.accessTokenEncrypted).toBe('enc');
    expect(updated?.status).toBe('connected');
    expect(await prisma.tellerEnrollment.count()).toBe(1);
  });

  it('adopts prior connections and deletes the stale row when everything matches', async () => {
    const stale = await seedEnrollment('enr_old');
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
      tellerAccount({
        id: 'acc_fresh_card',
        last_four: '4242',
        name: 'Amazon Card',
        type: 'credit',
        subtype: 'credit_card',
      }),
    ]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'fresh-token' }));
    const body = await res.json();

    expect(body.merged).toBe(true);
    expect(body.reconnected).toBe(1);
    expect(body.unmatched).toHaveLength(0);
    expect(body.discovered.map((a: { externalId: string }) => a.externalId)).toEqual([
      'acc_fresh_card',
    ]);

    // Stale row gone, connection moved onto the new enrollment with the new account id.
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    const moved = await prisma.tellerConnection.findUnique({ where: { id: checking.id } });
    expect(moved?.tellerEnrollmentId).toBe(body.enrollmentId);
    expect(moved?.tellerAccountId).toBe('acc_fresh_checking');
    expect(moved?.status).toBe('connected');
  });

  it('keeps the stale enrollment when a connection cannot be matched', async () => {
    const stale = await seedEnrollment('enr_old');
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });
    const orphan = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_closed',
      lastFour: '0000',
      name: 'Closed Savings',
      subtype: 'savings',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
    ]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'fresh-token' }));
    const body = await res.json();

    expect(body.reconnected).toBe(1);
    expect(body.unmatched).toHaveLength(1);
    expect(body.unmatched[0].connectionId).toBe(orphan.id);

    // Both enrollments survive, and crucially BOTH connections still exist —
    // deleting the stale row would cascade and destroy the orphan's linkage.
    expect(await prisma.tellerEnrollment.count()).toBe(2);
    expect(await prisma.tellerConnection.count()).toBe(2);

    const staleAfter = await prisma.tellerEnrollment.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe('disconnected');

    const movedChecking = await prisma.tellerConnection.findUnique({ where: { id: checking.id } });
    expect(movedChecking?.tellerEnrollmentId).toBe(body.enrollmentId);
  });

  it('creates a plain new enrollment when the institution is not already connected', async () => {
    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount({ id: 'acc_a', last_four: '1111' })]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_first', accessToken: 'token' }));
    const body = await res.json();

    expect(body.merged).toBe(false);
    expect(body.reconnected).toBe(0);
    expect(body.discovered).toHaveLength(1);
    expect(await prisma.tellerEnrollment.count()).toBe(1);
  });

  it('is idempotent when the same payload is replayed', async () => {
    const stale = await seedEnrollment('enr_old');
    await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
    ]);

    const first = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'token' }));
    const firstBody = await first.json();
    const second = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'token' }));
    const secondBody = await second.json();

    expect(secondBody.enrollmentId).toBe(firstBody.enrollmentId);
    expect(secondBody.reconnected).toBe(1);
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    expect(await prisma.tellerConnection.count()).toBe(1);
  });

  it('returns 404 when the token resolves to no accounts and no institution is known', async () => {
    vi.mocked(tellerFetch).mockResolvedValue([]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_empty', accessToken: 'token' }));

    expect(res.status).toBe(400);
    expect(await prisma.tellerEnrollment.count()).toBe(0);
  });
});
