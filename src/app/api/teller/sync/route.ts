import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { syncTellerTransactions } from '@/lib/teller-sync';
import { withSyncLock } from '@/lib/sync-common';
import { classifyTellerError } from '@/lib/bank-errors';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  includePending: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  let accountId: string | undefined;
  let tellerEnrollmentId: string | undefined;

  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    accountId = parsed.accountId;

    const connection = await prisma.tellerConnection.findUnique({
      where: { accountId },
      include: {
        account: true,
        tellerEnrollment: true,
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Teller connection found for this account' },
        { status: 404 }
      );
    }

    tellerEnrollmentId = connection.tellerEnrollmentId;

    if (connection.status === 'disconnected') {
      return NextResponse.json(
        { error: 'Account is disconnected. Please reconnect.', code: 'DISCONNECTED' },
        { status: 400 }
      );
    }

    const runSync = () =>
      syncTellerTransactions(connection, {
        daysToSync: parsed.daysToSync,
        includePending: parsed.includePending,
        dryRun: parsed.dryRun,
      });

    // Serialize real syncs of the same account so two concurrent runs can't
    // interleave their dedup checks and writes. Dry runs are read-only, so they
    // don't need the lock.
    const result = parsed.dryRun
      ? await runSync()
      : await withSyncLock(`teller:${accountId}`, runSync);

    return NextResponse.json({
      success: true,
      dryRun: parsed.dryRun,
      ...result,
    });
  } catch (error: unknown) {
    // Detect errors that require re-authentication through Teller Connect
    // (e.g. Teller's verbatim "Enrollment is not healthy" when a bank session
    // is invalidated by a password change, MFA expiry, or OAuth revoke).
    const { needsReauth, reason } = classifyTellerError(error);

    if (!needsReauth) {
      console.error('Error syncing Teller transactions:', error);
    }

    if (needsReauth && accountId) {
      try {
        // Update the connection status
        await prisma.tellerConnection.update({
          where: { accountId },
          data: {
            status: 'disconnected',
            lastSyncStatus: 'error',
            lastSyncError: reason || 'Reconnection required.',
          },
        });

        // Also update the enrollment status
        if (tellerEnrollmentId) {
          await prisma.tellerEnrollment.update({
            where: { id: tellerEnrollmentId },
            data: {
              status: 'disconnected',
            },
          });
        }
      } catch (updateError) {
        console.error('Failed to update disconnected status:', updateError);
      }

      return NextResponse.json(
        { error: reason || 'Reconnection required.', code: 'AUTH_EXPIRED' },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
