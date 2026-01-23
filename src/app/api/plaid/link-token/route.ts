import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CountryCode, Products } from 'plaid';
import { getPlaidClient } from '@/lib/plaid';

const schema = z.object({
  accountId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId } = schema.parse(body);

    const plaid = getPlaidClient();

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
    const message = error instanceof Error ? error.message : 'Failed to create link token';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
