import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { encryptAccessToken } from '@/lib/encryption';
import { isUniqueConstraintError } from '@/lib/sync-common';

const schema = z.object({
  publicToken: z.string(),
  accountId: z.string(),
  plaidAccountId: z.string(),
  plaidAccountName: z.string().optional(),
  plaidAccountType: z.string().optional(),
  plaidAccountSubtype: z.string().optional(),
  plaidAccountMask: z.string().optional(),
  institutionId: z.string().optional(),
  institutionName: z.string().optional(),
});

// This route creates both enrollment and connection in one step
// (for backwards compatibility with direct account linking flow)
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

    // Check if enrollment already exists for this item
    let enrollment = await prisma.plaidEnrollment.findUnique({
      where: { plaidItemId: itemId },
    });

    if (enrollment) {
      // Update existing enrollment with new token
      enrollment = await prisma.plaidEnrollment.update({
        where: { id: enrollment.id },
        data: {
          accessTokenEncrypted: encrypted,
          accessTokenIv: iv,
          status: 'connected',
        },
      });
    } else {
      // Create new enrollment
      enrollment = await prisma.plaidEnrollment.create({
        data: {
          plaidItemId: itemId,
          institutionId: parsed.institutionId,
          institutionName: parsed.institutionName || 'Unknown Bank',
          accessTokenEncrypted: encrypted,
          accessTokenIv: iv,
          status: 'connected',
        },
      });
    }

    // Create or update PlaidConnection
    const existingConnection = await prisma.plaidConnection.findUnique({
      where: { accountId: parsed.accountId },
    });

    let connection;
    if (existingConnection) {
      connection = await prisma.plaidConnection.update({
        where: { id: existingConnection.id },
        data: {
          plaidEnrollmentId: enrollment.id,
          plaidAccountId: parsed.plaidAccountId,
          plaidAccountName: parsed.plaidAccountName,
          plaidAccountType: parsed.plaidAccountType,
          plaidAccountSubtype: parsed.plaidAccountSubtype,
          plaidAccountMask: parsed.plaidAccountMask,
          status: 'connected',
          lastSyncError: null,
        },
      });
    } else {
      connection = await prisma.plaidConnection.create({
        data: {
          accountId: parsed.accountId,
          plaidEnrollmentId: enrollment.id,
          plaidAccountId: parsed.plaidAccountId,
          plaidAccountName: parsed.plaidAccountName,
          plaidAccountType: parsed.plaidAccountType,
          plaidAccountSubtype: parsed.plaidAccountSubtype,
          plaidAccountMask: parsed.plaidAccountMask,
          status: 'connected',
        },
      });
    }

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
      enrollmentId: enrollment.id,
    });
  } catch (error: unknown) {
    // Bare create — the (plaidEnrollmentId, plaidAccountId) unique constraint can still
    // trip if this bank account got linked elsewhere between the check above and this
    // write. Surface that as a clean 409 rather than a raw 500.
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'This bank account is already linked' }, { status: 409 });
    }

    console.error('Error exchanging token:', error);
    const message = error instanceof Error ? error.message : 'Failed to exchange token';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
