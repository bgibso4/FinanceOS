import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { encryptAccessToken } from '@/lib/encryption';

const schema = z.object({
  publicToken: z.string(),
  accountId: z.string(),
  plaidAccountId: z.string(),
  institutionId: z.string().optional(),
  institutionName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);

    const plaid = getPlaidClient();

    // Exchange public token for access token
    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: parsed.publicToken,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Encrypt the access token
    const { encrypted, iv } = encryptAccessToken(accessToken);

    // Create or update PlaidConnection
    const connection = await prisma.plaidConnection.upsert({
      where: { accountId: parsed.accountId },
      create: {
        accountId: parsed.accountId,
        plaidItemId: itemId,
        plaidAccountId: parsed.plaidAccountId,
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        institutionName: parsed.institutionName,
        status: 'connected',
      },
      update: {
        plaidItemId: itemId,
        plaidAccountId: parsed.plaidAccountId,
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        institutionName: parsed.institutionName,
        status: 'connected',
        lastSyncError: null,
      },
    });

    // Update account institution name if provided
    if (parsed.institutionName) {
      await prisma.account.update({
        where: { id: parsed.accountId },
        data: { institution: parsed.institutionName },
      });
    }

    return NextResponse.json({
      success: true,
      connectionId: connection.id,
    });
  } catch (error: unknown) {
    console.error('Error exchanging token:', error);
    const message = error instanceof Error ? error.message : 'Failed to exchange token';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
