import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tellerFetch, TellerAccountsResponse } from '@/lib/teller';
import { decryptAccessToken } from '@/lib/encryption';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const enrollmentId = params.id;
    console.log('[Teller Enrollment Accounts API] Fetching accounts for enrollment:', enrollmentId);

    // Get enrollment with access token
    const enrollment = await prisma.tellerEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    // Decrypt access token
    const accessToken = decryptAccessToken(
      enrollment.accessTokenEncrypted,
      enrollment.accessTokenIv
    );

    // Fetch accounts from Teller
    console.log('[Teller Enrollment Accounts API] Fetching accounts from Teller...');
    const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', accessToken);

    console.log('[Teller Enrollment Accounts API] Found', accounts.length, 'accounts');

    return NextResponse.json({
      success: true,
      accounts,
    });
  } catch (error: unknown) {
    console.error('[Teller Enrollment Accounts API] ERROR:', error);
    if (error instanceof Error) {
      console.error('[Teller Enrollment Accounts API] Error message:', error.message);
      console.error('[Teller Enrollment Accounts API] Error stack:', error.stack);
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch accounts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
