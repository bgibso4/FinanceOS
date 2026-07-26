import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptAccessToken } from '@/lib/encryption';
import { tellerFetch, type TellerAccount, type TellerAccountsResponse } from '@/lib/teller';
import { matchConnectionsToAccounts, type ProviderAccount } from '@/lib/bank-account-matching';

const schema = z.object({
  enrollmentId: z.string(),
  accessToken: z.string(),
  // Our DB id (not Teller's) for a previously-known enrollment at the same institution
  // that the caller wants folded into the live one. Only ever supplied explicitly by
  // the caller — never inferred — so two logins at the same bank (e.g. personal +
  // joint) can never be confused with each other.
  priorEnrollmentId: z.string().optional(),
});

function toProviderAccount(account: TellerAccount): ProviderAccount {
  return {
    externalId: account.id,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    lastFour: account.last_four,
  };
}

type UnmatchedEntry = { connectionId: string; name: string | null; lastFour: string | null };

type ResponseBody = {
  success: true;
  enrollmentId: string;
  // True only when at least one connection is actually confirmed live under this
  // enrollment as a result of this call — either freshly reconnected in place or
  // adopted from a prior enrollment. A prior named but contributing nothing (already
  // fully adopted, or empty) yields `merged: false`, even though adoption code ran.
  merged: boolean;
  reconnected: number;
  discovered: ProviderAccount[];
  unmatched: UnmatchedEntry[];
};

/**
 * Intersect an enrollment's stored connections against the accounts Teller actually
 * returned this call. A connection only gets marked `connected` (and has
 * `lastSyncError` cleared) when Teller still reports its account — blanket-resetting
 * every connection would erase evidence that a closed account's connection is broken.
 * Used by both the plain refresh path and the adoption path so `reconnected`/`unmatched`
 * mean the same thing regardless of which path produced them.
 */
async function reconcileLiveConnections(
  live: { id: string },
  accounts: TellerAccountsResponse
): Promise<{ reconnectedCount: number; linkedIds: Set<string>; unmatched: UnmatchedEntry[] }> {
  const connections = await prisma.tellerConnection.findMany({
    where: { tellerEnrollmentId: live.id },
  });
  const accountIds = new Set(accounts.map((a) => a.id));

  const stillLinked = connections.filter((c) => accountIds.has(c.tellerAccountId));
  const droppedByProvider = connections.filter((c) => !accountIds.has(c.tellerAccountId));

  for (const connection of stillLinked) {
    await prisma.tellerConnection.update({
      where: { id: connection.id },
      data: { status: 'connected', lastSyncError: null },
    });
  }

  return {
    reconnectedCount: stillLinked.length,
    linkedIds: new Set(connections.map((c) => c.tellerAccountId)),
    unmatched: droppedByProvider.map((c) => ({
      connectionId: c.id,
      name: c.tellerAccountName,
      lastFour: c.tellerAccountLastFour,
    })),
  };
}

/**
 * Refresh a live enrollment's own connections against the fresh account list, with no
 * adoption from another enrollment involved.
 */
async function refreshLiveEnrollment(
  live: { id: string },
  accounts: TellerAccountsResponse
): Promise<ResponseBody> {
  const { reconnectedCount, linkedIds, unmatched } = await reconcileLiveConnections(live, accounts);

  return {
    success: true,
    enrollmentId: live.id,
    merged: false,
    reconnected: reconnectedCount,
    discovered: accounts.filter((a) => !linkedIds.has(a.id)).map(toProviderAccount),
    unmatched,
  };
}

/**
 * Move a previously-known enrollment's connections onto the live one (`live`), which
 * may be a brand-new row (Case 2) or the row that already existed for this enrollment
 * id (Case 1, resuming a Case-2 run that crashed after `live` was created but before
 * every connection was migrated off `prior`).
 *
 * `prior`'s connections are re-read from the DB rather than trusted from an earlier
 * snapshot — both so a connection created concurrently under `prior` isn't cascaded
 * away unexamined, and so a retry after a partial run only has to move the stragglers
 * still sitting on `prior` (the ones already moved in an earlier attempt are no longer
 * there to re-match).
 *
 * Accounts already claimed by `live`'s OWN connections are excluded from the match pool
 * before matching `prior`'s leftovers. Without this, a retry can re-match a still-
 * unmatched prior connection onto an account another prior connection already claimed
 * on `live` in an earlier attempt — `tellerAccountId` has no unique constraint, so that
 * would silently create two connections pointing at the same bank account.
 */
async function adoptPriorEnrollment(
  live: { id: string },
  prior: { id: string },
  accounts: TellerAccountsResponse
): Promise<ResponseBody> {
  const [priorConnections, liveConnectionsBefore] = await Promise.all([
    prisma.tellerConnection.findMany({ where: { tellerEnrollmentId: prior.id } }),
    prisma.tellerConnection.findMany({ where: { tellerEnrollmentId: live.id } }),
  ]);

  const alreadyClaimedIds = new Set(liveConnectionsBefore.map((c) => c.tellerAccountId));
  const availableAccounts = accounts.filter((a) => !alreadyClaimedIds.has(a.id));

  const result = matchConnectionsToAccounts(
    priorConnections.map((c) => ({
      id: c.id,
      externalId: c.tellerAccountId,
      name: c.tellerAccountName,
      type: c.tellerAccountType,
      subtype: c.tellerAccountSubtype,
      lastFour: c.tellerAccountLastFour,
    })),
    availableAccounts.map(toProviderAccount)
  );

  for (const { connectionId, account } of result.matched) {
    await prisma.tellerConnection.update({
      where: { id: connectionId },
      data: {
        tellerEnrollmentId: live.id,
        tellerAccountId: account.externalId,
        tellerAccountName: account.name,
        tellerAccountType: account.type,
        tellerAccountSubtype: account.subtype,
        tellerAccountLastFour: account.lastFour,
        status: 'connected',
        lastSyncError: null,
      },
    });
  }

  if (result.unmatchedConnections.length === 0) {
    // Guard the delete against the DB's live state, not the snapshot read above — a
    // connection created under `prior` in the window since then must block the delete
    // rather than being cascaded away unexamined.
    const deleted = await prisma.tellerEnrollment.deleteMany({
      where: { id: prior.id, connections: { none: {} } },
    });
    if (deleted.count === 0) {
      await prisma.tellerEnrollment.update({
        where: { id: prior.id },
        data: { status: 'disconnected' },
      });
    }
  } else {
    // Deleting would cascade and destroy the unmatched connections along with their
    // account linkage. Park the row as disconnected instead and let the caller surface
    // the leftovers for manual re-mapping.
    await prisma.tellerEnrollment.update({
      where: { id: prior.id },
      data: { status: 'disconnected' },
    });
  }

  const unmatchedFromPrior: UnmatchedEntry[] = result.unmatchedConnections.map((c) => ({
    connectionId: c.id,
    name: c.name,
    lastFour: c.lastFour,
  }));

  // Reconcile `live`'s full, authoritative post-move connection set the same way the
  // plain refresh path does. This makes `reconnected`/`unmatched` mean the same thing
  // regardless of origin: a pre-existing `live` connection for an account Teller no
  // longer returns lands in `unmatched`, not silently in `reconnected`. It also means a
  // retry doesn't re-report already-migrated accounts as newly "discovered".
  const liveState = await reconcileLiveConnections(live, accounts);

  return {
    success: true,
    enrollmentId: live.id,
    merged: liveState.reconnectedCount > 0,
    reconnected: liveState.reconnectedCount,
    discovered: accounts.filter((a) => !liveState.linkedIds.has(a.id)).map(toProviderAccount),
    unmatched: [...unmatchedFromPrior, ...liveState.unmatched],
  };
}

/**
 * Re-runs of Teller Connect against an already-enrolled institution land here.
 *
 * Two outcomes are possible and both must work:
 *   1. Teller returns the SAME enrollment id — refresh the stored token in place.
 *   2. Teller mints a NEW enrollment id — create it, then move a caller-identified
 *      prior enrollment's connections onto the new token so the user keeps every
 *      existing account linkage (and its transaction history).
 *
 * `priorEnrollmentId` must be supplied explicitly by the caller to trigger adoption in
 * either case — it is never inferred from `institutionId`. Two logins at the same bank
 * (personal + joint) can share an `institutionId`, and inferring "the" prior enrollment
 * from that column risks re-pointing one login's connections onto the other's token, or
 * deleting a healthy, unrelated enrollment.
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.parse(await req.json());

    // Validate the new token BEFORE writing anything. tellerFetch routinely throws
    // (expired token, 429 rate limit, timeout, network blip) — if that happens after we
    // had already overwritten the stored token, the working token is gone for good and
    // the caller no longer holds it to retry with.
    const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', parsed.accessToken);

    const institutionId = accounts[0]?.institution?.id;
    const institutionName = accounts[0]?.institution?.name;
    if (!institutionId || !institutionName) {
      // No accounts (or a malformed third-party payload) means we cannot tell which
      // institution this token belongs to, so we cannot safely reconcile it against
      // anything. Store nothing.
      return NextResponse.json(
        { error: 'Could not determine the institution for this enrollment' },
        { status: 400 }
      );
    }

    // Resolve the explicit adoption source, if the caller named one. A prior that no
    // longer exists (e.g. a replay after it was already fully adopted and deleted) is
    // treated as "nothing left to adopt" rather than an error, so retries stay
    // idempotent. A prior that exists but belongs to a different institution is a
    // genuine caller error and must not silently do nothing or touch any data.
    let prior: { id: string } | null = null;
    if (parsed.priorEnrollmentId) {
      const found = await prisma.tellerEnrollment.findUnique({
        where: { id: parsed.priorEnrollmentId },
        select: { id: true, institutionId: true },
      });
      if (found) {
        if (found.institutionId !== institutionId) {
          return NextResponse.json(
            { error: 'priorEnrollmentId does not belong to this institution' },
            { status: 400 }
          );
        }
        prior = { id: found.id };
      }
    }

    const { encrypted, iv } = encryptAccessToken(parsed.accessToken);

    const existing = await prisma.tellerEnrollment.findUnique({
      where: { enrollmentId: parsed.enrollmentId },
    });

    // ── Case 1: same enrollment id came back ─────────────────────────────────
    if (existing) {
      await prisma.tellerEnrollment.update({
        where: { id: existing.id },
        data: { accessTokenEncrypted: encrypted, accessTokenIv: iv, status: 'connected' },
      });

      if (prior && prior.id !== existing.id) {
        // A prior enrollment was explicitly named and it isn't this one — adopt it. This
        // is also the resumption path for a Case-2 run that crashed after creating this
        // row but before every connection had been migrated off `prior`.
        return NextResponse.json(await adoptPriorEnrollment(existing, prior, accounts));
      }

      return NextResponse.json(await refreshLiveEnrollment(existing, accounts));
    }

    // ── Case 2: Teller minted a new enrollment ───────────────────────────────
    const created = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: parsed.enrollmentId,
        institutionId,
        institutionName,
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        status: 'connected',
      },
    });

    if (!prior) {
      return NextResponse.json({
        success: true,
        enrollmentId: created.id,
        merged: false,
        reconnected: 0,
        discovered: accounts.map(toProviderAccount),
        unmatched: [],
      });
    }

    return NextResponse.json(await adoptPriorEnrollment(created, prior, accounts));
  } catch (error: unknown) {
    console.error('[Teller Enrollment Update API] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to update enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
