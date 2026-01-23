import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { tellerFetch, TellerAccountsResponse } from '@/lib/teller';

const schema = z.object({
  accessToken: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Teller Accounts API] Request received');

    const parsed = schema.parse(body);

    // Fetch accounts from Teller
    console.log('[Teller Accounts API] Fetching accounts from Teller...');
    const accounts = await tellerFetch<TellerAccountsResponse>(
      '/accounts',
      parsed.accessToken
    );

    console.log('[Teller Accounts API] Found', accounts.length, 'accounts');

    return NextResponse.json({
      success: true,
      accounts,
    });
  } catch (error: unknown) {
    console.error('[Teller Accounts API] ERROR:', error);
    if (error instanceof Error) {
      console.error('[Teller Accounts API] Error message:', error.message);
      console.error('[Teller Accounts API] Error stack:', error.stack);
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch accounts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
