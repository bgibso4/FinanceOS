import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { syncPlaidTransactions } from '@/lib/plaid-sync';
import { withSyncLock } from '@/lib/sync-common';
import { classifyPlaidError } from '@/lib/bank-errors';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  // Hoisted so the catch block can persist re-auth status. The old code
  // re-read `await req.json()` in the catch, but the body stream was already
  // consumed, so it silently resolved to `{}` and never marked the connection.
  let accountId: string | undefined;
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    accountId = parsed.accountId;
    const { daysToSync, dryRun } = parsed;

    const connection = await prisma.plaidConnection.findUnique({
      where: { accountId },
      include: {
        account: true,
        plaidEnrollment: true,
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Plaid connection found for this account' },
        { status: 404 }
      );
    }

    if (connection.status === 'needs_reauth') {
      return NextResponse.json(
        { error: 'Account requires re-authentication', code: 'NEEDS_REAUTH' },
        { status: 400 }
      );
    }

    // Serialize real syncs by enrollment: Plaid's transactionsSync cursor is
    // shared across all sibling accounts under one item, so two concurrent runs
    // of any account in the item must not overlap. Dry runs are read-only.
    const result = dryRun
      ? await syncPlaidTransactions(connection, { daysToSync, dryRun })
      : await withSyncLock(`plaid:${connection.plaidEnrollment.id}`, () =>
          syncPlaidTransactions(connection, { daysToSync, dryRun })
        );

    return NextResponse.json({
      success: true,
      dryRun,
      ...result,
    });
  } catch (error: unknown) {
    const { needsReauth, code, reason } = classifyPlaidError(error);

    if (needsReauth) {
      // Expected lifecycle state (stale bank session) — log concisely rather
      // than dumping the multi-KB AxiosError, and persist so the account shows
      // "Needs Reconnection".
      console.warn(`Plaid sync needs reconnection${code ? ` (${code})` : ''}: ${reason}`);
      if (accountId) {
        await prisma.plaidConnection
          .update({
            where: { accountId },
            data: { status: 'needs_reauth', lastSyncStatus: 'error', lastSyncError: reason },
          })
          .catch((e) => console.error('Failed to update connection status:', e));
      }
      return NextResponse.json(
        { error: 'Bank login required', code: 'NEEDS_REAUTH' },
        { status: 400 }
      );
    }

    console.error('Error syncing transactions:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
