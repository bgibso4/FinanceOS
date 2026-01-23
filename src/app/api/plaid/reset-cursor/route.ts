import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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

    // Reset the cursor to null - next sync will start from beginning
    await prisma.plaidConnection.update({
      where: { id: connection.id },
      data: {
        transactionCursor: null,
        lastSyncStatus: 'never',
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error resetting cursor:', error);
    const message = error instanceof Error ? error.message : 'Failed to reset cursor';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
