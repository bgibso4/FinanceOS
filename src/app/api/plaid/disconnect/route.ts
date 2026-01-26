import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { decryptAccessToken } from '@/lib/encryption';

const schema = z.object({
  accountId: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId } = schema.parse(body);

    const connection = await prisma.plaidConnection.findUnique({
      where: { accountId },
      include: { plaidEnrollment: true },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Plaid connection found for this account' },
        { status: 404 }
      );
    }

    // Delete local connection (keep enrollment for other accounts)
    await prisma.plaidConnection.delete({
      where: { id: connection.id },
    });

    // Check if enrollment has any remaining connections
    if (connection.plaidEnrollment) {
      const remainingConnections = await prisma.plaidConnection.count({
        where: { plaidEnrollmentId: connection.plaidEnrollment.id },
      });

      // If no remaining connections, remove Plaid item and delete enrollment
      if (remainingConnections === 0) {
        try {
          const plaid = getPlaidClient();
          const accessToken = decryptAccessToken(
            connection.plaidEnrollment.accessTokenEncrypted,
            connection.plaidEnrollment.accessTokenIv
          );
          await plaid.itemRemove({ access_token: accessToken });
        } catch (plaidError) {
          console.error('Error removing Plaid item:', plaidError);
        }

        await prisma.plaidEnrollment.delete({
          where: { id: connection.plaidEnrollment.id },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error disconnecting:', error);
    const message = error instanceof Error ? error.message : 'Failed to disconnect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
