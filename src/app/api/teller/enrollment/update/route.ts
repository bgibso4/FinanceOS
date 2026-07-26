import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptAccessToken } from '@/lib/encryption';
import { tellerFetch, type TellerAccount, type TellerAccountsResponse } from '@/lib/teller';
import { matchConnectionsToAccounts, type ProviderAccount } from '@/lib/bank-account-matching';

const schema = z.object({
  enrollmentId: z.string(),
  accessToken: z.string(),
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

/**
 * Re-runs of Teller Connect against an already-enrolled institution land here.
 *
 * Two outcomes are possible and both must work:
 *   1. Teller returns the SAME enrollment id — refresh the stored token in place.
 *   2. Teller mints a NEW enrollment id — create it, then move the prior
 *      enrollment's connections onto the new token so the user keeps every
 *      existing account linkage (and its transaction history).
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.parse(await req.json());
    const { encrypted, iv } = encryptAccessToken(parsed.accessToken);

    const existing = await prisma.tellerEnrollment.findUnique({
      where: { enrollmentId: parsed.enrollmentId },
      include: { connections: true },
    });

    // ── Case 1: same enrollment came back ────────────────────────────────────
    if (existing) {
      await prisma.tellerEnrollment.update({
        where: { id: existing.id },
        data: { accessTokenEncrypted: encrypted, accessTokenIv: iv, status: 'connected' },
      });
      await prisma.tellerConnection.updateMany({
        where: { tellerEnrollmentId: existing.id },
        data: { status: 'connected', lastSyncError: null },
      });

      const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', parsed.accessToken);
      const linkedIds = new Set(existing.connections.map((c) => c.tellerAccountId));

      return NextResponse.json({
        success: true,
        enrollmentId: existing.id,
        merged: false,
        reconnected: existing.connections.length,
        discovered: accounts.filter((a) => !linkedIds.has(a.id)).map(toProviderAccount),
        unmatched: [],
      });
    }

    // ── Case 2: Teller minted a new enrollment ───────────────────────────────
    const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', parsed.accessToken);

    const institutionId = accounts[0]?.institution.id;
    const institutionName = accounts[0]?.institution.name;
    if (!institutionId || !institutionName) {
      // No accounts means we cannot tell which institution this token belongs to,
      // so we cannot safely reconcile it against anything. Store nothing.
      return NextResponse.json(
        { error: 'Could not determine the institution for this enrollment' },
        { status: 400 }
      );
    }

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

    const prior = await prisma.tellerEnrollment.findFirst({
      where: { institutionId, id: { not: created.id } },
      include: { connections: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!prior || prior.connections.length === 0) {
      // Nothing to adopt. Drop an empty stale row if one was sitting there.
      if (prior) {
        await prisma.tellerEnrollment.delete({ where: { id: prior.id } });
      }
      return NextResponse.json({
        success: true,
        enrollmentId: created.id,
        merged: false,
        reconnected: 0,
        discovered: accounts.map(toProviderAccount),
        unmatched: [],
      });
    }

    const result = matchConnectionsToAccounts(
      prior.connections.map((c) => ({
        id: c.id,
        externalId: c.tellerAccountId,
        name: c.tellerAccountName,
        type: c.tellerAccountType,
        subtype: c.tellerAccountSubtype,
        lastFour: c.tellerAccountLastFour,
      })),
      accounts.map(toProviderAccount)
    );

    for (const { connectionId, account } of result.matched) {
      await prisma.tellerConnection.update({
        where: { id: connectionId },
        data: {
          tellerEnrollmentId: created.id,
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
      await prisma.tellerEnrollment.delete({ where: { id: prior.id } });
    } else {
      // Deleting would cascade and destroy the unmatched connections along with
      // their account linkage. Park the row as disconnected instead and let the
      // caller surface the leftovers for manual re-mapping.
      await prisma.tellerEnrollment.update({
        where: { id: prior.id },
        data: { status: 'disconnected' },
      });
    }

    const claimed = new Set(result.matched.map((m) => m.account.externalId));

    return NextResponse.json({
      success: true,
      enrollmentId: created.id,
      merged: true,
      reconnected: result.matched.length,
      discovered: accounts.filter((a) => !claimed.has(a.id)).map(toProviderAccount),
      unmatched: result.unmatchedConnections.map((c) => ({
        connectionId: c.id,
        name: c.name,
        lastFour: c.lastFour,
      })),
    });
  } catch (error: unknown) {
    console.error('[Teller Enrollment Update API] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to update enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
