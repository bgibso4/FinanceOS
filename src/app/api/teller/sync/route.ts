import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { syncTellerTransactions } from '@/lib/teller-sync';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  includePending: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId, daysToSync, includePending } = schema.parse(body);

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

    if (connection.status === 'disconnected') {
      return NextResponse.json(
        { error: 'Account is disconnected', code: 'DISCONNECTED' },
        { status: 400 }
      );
    }

    const result = await syncTellerTransactions(connection, {
      daysToSync,
      includePending,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    console.error('Error syncing Teller transactions:', error);

    // Update connection status if there's an auth error
    const errorMessage = error instanceof Error ? error.message : '';
    if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.accountId) {
          await prisma.tellerConnection.update({
            where: { accountId: body.accountId },
            data: {
              status: 'disconnected',
              lastSyncError: 'Authorization expired. Please reconnect.',
            },
          });
        }
      } catch {
        // Ignore secondary errors
      }
      return NextResponse.json(
        { error: 'Authorization expired. Please reconnect.', code: 'AUTH_EXPIRED' },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
