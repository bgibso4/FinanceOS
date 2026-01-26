import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { encryptAccessToken } from '@/lib/encryption';

const schema = z.object({
  enrollmentId: z.string(),
  publicToken: z.string(),
});

// POST: Re-authenticate a Plaid enrollment with a new access token
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { enrollmentId, publicToken } = schema.parse(body);

    const enrollment = await prisma.plaidEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    const plaid = getPlaidClient();

    // Exchange public token for access token
    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;

    // Encrypt the new access token
    const { encrypted, iv } = encryptAccessToken(accessToken);

    // Update enrollment with new token and reset status
    await prisma.plaidEnrollment.update({
      where: { id: enrollmentId },
      data: {
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        status: 'connected',
      },
    });

    // Reset all connection statuses to connected
    await prisma.plaidConnection.updateMany({
      where: { plaidEnrollmentId: enrollmentId },
      data: {
        status: 'connected',
        lastSyncError: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error reconnecting Plaid enrollment:', error);
    const message = error instanceof Error ? error.message : 'Failed to reconnect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
