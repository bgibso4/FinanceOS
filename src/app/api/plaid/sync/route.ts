import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { syncPlaidTransactions } from '@/lib/plaid-sync';
import { withSyncLock } from '@/lib/sync-common';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId, daysToSync, dryRun } = schema.parse(body);

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
    console.error('Error syncing transactions:', error);

    // Try to extract error code for Plaid errors
    const plaidError = error as { response?: { data?: { error_code?: string } } };
    const errorCode = plaidError.response?.data?.error_code;

    if (errorCode === 'ITEM_LOGIN_REQUIRED') {
      // Update connection status
      const body = await req.json().catch(() => ({}));
      if (body.accountId) {
        await prisma.plaidConnection.update({
          where: { accountId: body.accountId },
          data: { status: 'needs_reauth' },
        });
      }
      return NextResponse.json(
        { error: 'Bank login required', code: 'NEEDS_REAUTH' },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
