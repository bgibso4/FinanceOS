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

    const res = await POST(
      updateRequest({
        enrollmentId: 'enr_new',
        accessToken: 'fresh-token',
        priorEnrollmentId: stale.id,
      })
    );
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

    const res = await POST(
      updateRequest({
        enrollmentId: 'enr_new',
        accessToken: 'fresh-token',
        priorEnrollmentId: stale.id,
      })
    );
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

    // The orphan must still be exactly where it started — pointed at the stale
    // enrollment and untouched — not silently re-pointed or its status changed.
    const orphanAfter = await prisma.tellerConnection.findUnique({ where: { id: orphan.id } });
    expect(orphanAfter?.tellerEnrollmentId).toBe(stale.id);
    expect(orphanAfter?.status).toBe('connected');
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

    const first = await POST(
      updateRequest({ enrollmentId: 'enr_new', accessToken: 'token', priorEnrollmentId: stale.id })
    );
    const firstBody = await first.json();
    // Replayed with the same priorEnrollmentId, which the first call already deleted.
    // A not-found prior must be treated as "nothing left to adopt", not an error —
    // otherwise a simple retry of an already-successful call would break.
    const second = await POST(
      updateRequest({ enrollmentId: 'enr_new', accessToken: 'token', priorEnrollmentId: stale.id })
    );
    const secondBody = await second.json();

    expect(secondBody.enrollmentId).toBe(firstBody.enrollmentId);
    expect(secondBody.reconnected).toBe(1);
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    expect(await prisma.tellerConnection.count()).toBe(1);
  });

  it('deletes an empty prior enrollment named explicitly, with nothing to adopt', async () => {
    const stale = await seedEnrollment('enr_old');
    // No connections seeded under `stale` — it is a dangling, empty enrollment row.

    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount({ id: 'acc_a', last_four: '1111' })]);

    const res = await POST(
      updateRequest({ enrollmentId: 'enr_new', accessToken: 'token', priorEnrollmentId: stale.id })
    );
    const body = await res.json();

    expect(body.merged).toBe(false);
    expect(body.reconnected).toBe(0);
    expect(body.discovered).toHaveLength(1);
    expect(body.discovered[0].externalId).toBe('acc_a');

    // The empty stale row is gone; only the newly created enrollment remains.
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    const remaining = await prisma.tellerEnrollment.findUnique({
      where: { id: body.enrollmentId },
    });
    expect(remaining?.enrollmentId).toBe('enr_new');
  });

  it('rejects a priorEnrollmentId that belongs to a different institution', async () => {
    const otherBank = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_wells',
        institutionId: 'wells',
        institutionName: 'Wells Fargo',
        accessTokenEncrypted: 'wells-enc',
        accessTokenIv: 'wells-iv',
        status: 'connected',
      },
    });
    const wellsConnection = await seedConnection(otherBank.id, {
      tellerAccountId: 'acc_wells_checking',
      lastFour: '9999',
      name: 'Wells Checking',
    });

    // tellerAccount() defaults to institution "chase" — a mismatch against `otherBank`.
    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount({ id: 'acc_a', last_four: '1111' })]);

    const res = await POST(
      updateRequest({
        enrollmentId: 'enr_new_bank',
        accessToken: 'token',
        priorEnrollmentId: otherBank.id,
      })
    );

    expect(res.status).toBe(400);

    // Nothing was written: no new enrollment created, the other bank's row and its
    // connection are untouched.
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    const otherBankAfter = await prisma.tellerEnrollment.findUnique({
      where: { id: otherBank.id },
    });
    expect(otherBankAfter?.status).toBe('connected');
    const wellsConnectionAfter = await prisma.tellerConnection.findUnique({
      where: { id: wellsConnection.id },
    });
    expect(wellsConnectionAfter?.tellerEnrollmentId).toBe(otherBank.id);
  });

  it('returns 400 when the token resolves to no accounts and no institution is known', async () => {
    vi.mocked(tellerFetch).mockResolvedValue([]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_empty', accessToken: 'token' }));

    expect(res.status).toBe(400);
    expect(await prisma.tellerEnrollment.count()).toBe(0);
  });

  it('leaves the stored token and status untouched when the fresh token fails to validate', async () => {
    const enrollment = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_broken',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'old-enc',
        accessTokenIv: 'old-iv',
        status: 'disconnected',
      },
    });

    vi.mocked(tellerFetch).mockRejectedValue(new Error('Teller API error: 401'));

    const res = await POST(updateRequest({ enrollmentId: 'enr_broken', accessToken: 'bad-token' }));

    expect(res.status).toBe(500);

    // A rejected tellerFetch must not have touched the stored token or status — if it
    // had, the working token would be gone for good with no way to recover it.
    const after = await prisma.tellerEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(after?.accessTokenEncrypted).toBe('old-enc');
    expect(after?.accessTokenIv).toBe('old-iv');
    expect(after?.status).toBe('disconnected');
  });

  it('adopts a separately-named prior enrollment onto an existing live enrollment', async () => {
    const live = await seedEnrollment('enr_live');
    const stale = await seedEnrollment('enr_old');
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
    ]);

    const res = await POST(
      updateRequest({
        enrollmentId: 'enr_live',
        accessToken: 'fresh-token',
        priorEnrollmentId: stale.id,
      })
    );
    const body = await res.json();

    expect(body.enrollmentId).toBe(live.id);
    expect(body.merged).toBe(true);
    expect(body.reconnected).toBe(1);
    expect(body.unmatched).toHaveLength(0);

    // The prior's connection is re-pointed onto the live enrollment, and the fully
    // adopted stale row is deleted.
    const moved = await prisma.tellerConnection.findUnique({ where: { id: checking.id } });
    expect(moved?.tellerEnrollmentId).toBe(live.id);
    expect(moved?.tellerAccountId).toBe('acc_fresh_checking');
    expect(moved?.status).toBe('connected');
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    expect(await prisma.tellerEnrollment.findUnique({ where: { id: stale.id } })).toBeNull();

    // The live enrollment's own token was refreshed too.
    const liveAfter = await prisma.tellerEnrollment.findUnique({ where: { id: live.id } });
    expect(liveAfter?.accessTokenEncrypted).toBe('enc');
    expect(liveAfter?.status).toBe('connected');
  });

  it('does not duplicate a tellerAccountId when a retry re-processes a still-unmatched connection', async () => {
    const stale = await seedEnrollment('enr_old');
    // Two prior connections share a last four but differ in subtype, so only one of
    // them is an unambiguous match against the single fresh account below.
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
      subtype: 'checking',
    });
    const savings = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_savings',
      lastFour: '3857',
      name: 'Old Savings',
      subtype: 'savings',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857', subtype: 'checking' }),
    ]);

    // First call: `checking` matches unambiguously at the lastFour+subtype tier and
    // moves onto the newly created enrollment. `savings` has no candidate at all in
    // this call (subtype mismatch, and its only lastFour match is already claimed by
    // `checking` within the same match pass), so it is correctly left on `stale`.
    const first = await POST(
      updateRequest({ enrollmentId: 'enr_new', accessToken: 'token', priorEnrollmentId: stale.id })
    );
    const firstBody = await first.json();
    expect(firstBody.reconnected).toBe(1);
    expect(firstBody.unmatched).toHaveLength(1);
    expect(firstBody.unmatched[0].connectionId).toBe(savings.id);

    // Second call: same request replayed. Without excluding accounts `live` already
    // holds from the match pool, `savings` would now be the sole remaining prior
    // connection and the single fetched account its sole remaining candidate at the
    // lastFour-only tier — an incorrect match, since that account is already claimed by
    // `checking`. It must stay unmatched instead of creating a duplicate.
    const second = await POST(
      updateRequest({ enrollmentId: 'enr_new', accessToken: 'token', priorEnrollmentId: stale.id })
    );
    const secondBody = await second.json();

    expect(secondBody.reconnected).toBe(1);
    expect(secondBody.unmatched).toHaveLength(1);
    expect(secondBody.unmatched[0].connectionId).toBe(savings.id);

    const liveConnections = await prisma.tellerConnection.findMany({
      where: { tellerEnrollmentId: secondBody.enrollmentId },
    });
    expect(liveConnections).toHaveLength(1);
    expect(liveConnections[0].id).toBe(checking.id);

    const tellerAccountIds = liveConnections.map((c) => c.tellerAccountId);
    expect(new Set(tellerAccountIds).size).toBe(tellerAccountIds.length);

    // `savings` is still exactly where it started: parked on the stale, disconnected
    // enrollment, not silently re-pointed onto an account another connection already
    // claimed.
    const savingsAfter = await prisma.tellerConnection.findUnique({ where: { id: savings.id } });
    expect(savingsAfter?.tellerEnrollmentId).toBe(stale.id);
  });

  it('reports a live connection Teller no longer returns as unmatched, not reconnected, even when adoption runs', async () => {
    const live = await seedEnrollment('enr_live');
    const closed = await seedConnection(live.id, {
      tellerAccountId: 'acc_closed',
      lastFour: '0000',
      name: 'Closed Account',
    });
    // Mark it broken up front so the test can prove reconciliation left it alone
    // instead of merely happening to already read "connected".
    await prisma.tellerConnection.update({
      where: { id: closed.id },
      data: { status: 'disconnected', lastSyncError: 'account closed' },
    });

    const stale = await seedEnrollment('enr_old');
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    // Teller no longer returns the account behind `closed` at all.
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
    ]);

    const res = await POST(
      updateRequest({
        enrollmentId: 'enr_live',
        accessToken: 'fresh-token',
        priorEnrollmentId: stale.id,
      })
    );
    const body = await res.json();

    // Only the adopted connection counts as reconnected; the pre-existing closed one
    // must land in unmatched instead of being silently counted as reconnected.
    expect(body.reconnected).toBe(1);
    expect(body.unmatched).toHaveLength(1);
    expect(body.unmatched[0].connectionId).toBe(closed.id);

    const movedChecking = await prisma.tellerConnection.findUnique({ where: { id: checking.id } });
    expect(movedChecking?.tellerEnrollmentId).toBe(live.id);
    expect(movedChecking?.status).toBe('connected');

    // The closed connection is left exactly as it was — not reset to `connected`, which
    // would erase the evidence that it is broken.
    const closedAfter = await prisma.tellerConnection.findUnique({ where: { id: closed.id } });
    expect(closedAfter?.tellerEnrollmentId).toBe(live.id);
    expect(closedAfter?.status).toBe('disconnected');
    expect(closedAfter?.lastSyncError).toBe('account closed');
  });
});
