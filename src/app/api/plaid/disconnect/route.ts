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
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Plaid connection found for this account' },
        { status: 404 }
      );
    }

    // Remove item from Plaid
    try {
      const plaid = getPlaidClient();
      const accessToken = decryptAccessToken(
        connection.accessTokenEncrypted,
        connection.accessTokenIv
      );
      await plaid.itemRemove({ access_token: accessToken });
    } catch (plaidError) {
      // Log but continue - we still want to remove local connection
      console.error('Error removing Plaid item:', plaidError);
    }

    // Delete local connection
    await prisma.plaidConnection.delete({
      where: { id: connection.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error disconnecting:', error);
    const message = error instanceof Error ? error.message : 'Failed to disconnect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
