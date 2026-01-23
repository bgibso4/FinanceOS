import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { tellerFetch } from '@/lib/teller';
import { decryptAccessToken } from '@/lib/encryption';

const schema = z.object({
  accountId: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId } = schema.parse(body);

    const connection = await prisma.tellerConnection.findUnique({
      where: { accountId },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Teller connection found for this account' },
        { status: 404 }
      );
    }

    // Try to delete enrollment from Teller
    try {
      const accessToken = decryptAccessToken(
        connection.accessTokenEncrypted,
        connection.accessTokenIv
      );
      await tellerFetch(
        `/accounts/${connection.tellerAccountId}`,
        accessToken,
        { method: 'DELETE' }
      );
    } catch (tellerError) {
      // Log but continue - we still want to remove local connection
      console.error('Error removing Teller enrollment:', tellerError);
    }

    // Delete local connection
    await prisma.tellerConnection.delete({
      where: { id: connection.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error disconnecting Teller:', error);
    const message = error instanceof Error ? error.message : 'Failed to disconnect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
