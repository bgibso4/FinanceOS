import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CountryCode, Products } from 'plaid';
import { getPlaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/prisma';
import { decryptAccessToken } from '@/lib/encryption';

const schema = z.object({
  accountId: z.string().optional(),
  enrollmentId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { enrollmentId } = schema.parse(body);

    const plaid = getPlaidClient();

    // If enrollmentId is provided, create an update mode link token for reconnection
    if (enrollmentId) {
      const enrollment = await prisma.plaidEnrollment.findUnique({
        where: { id: enrollmentId },
      });

      if (!enrollment) {
        return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
      }

      const accessToken = decryptAccessToken(
        enrollment.accessTokenEncrypted,
        enrollment.accessTokenIv
      );

      const response = await plaid.linkTokenCreate({
        user: { client_user_id: 'user-1' },
        client_name: 'FinanceOS',
        country_codes: [CountryCode.Us, CountryCode.Ca],
        language: 'en',
        access_token: accessToken,
      });

      return NextResponse.json({
        linkToken: response.data.link_token,
        expiration: response.data.expiration,
      });
    }

    // Standard link token for new connections
    const request = {
      user: { client_user_id: 'user-1' },
      client_name: 'FinanceOS',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: 'en',
    };

    const response = await plaid.linkTokenCreate(request);

    return NextResponse.json({
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error: unknown) {
    console.error('Error creating link token:', error);
    // Log the full Plaid error response
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { data?: unknown } };
      console.error('Plaid error details:', JSON.stringify(axiosError.response?.data, null, 2));
    }
    const message = error instanceof Error ? error.message : 'Failed to create link token';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
