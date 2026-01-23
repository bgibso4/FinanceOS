import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  accountId: z.string(),
  tellerEnrollmentId: z.string(), // DB ID of TellerEnrollment
  tellerAccountId: z.string(), // Teller's account ID
  tellerAccountName: z.string().optional(),
  tellerAccountType: z.string().optional(),
  tellerAccountSubtype: z.string().optional(),
  tellerAccountLastFour: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Teller Connect API] Request received:', {
      accountId: body.accountId,
      tellerEnrollmentId: body.tellerEnrollmentId,
      tellerAccountId: body.tellerAccountId,
    });

    const parsed = schema.parse(body);

    // Verify enrollment exists
    const enrollment = await prisma.tellerEnrollment.findUnique({
      where: { id: parsed.tellerEnrollmentId },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    console.log('[Teller Connect API] Linking to enrollment:', enrollment.institutionName);

    // Create or update TellerConnection
    console.log('[Teller Connect API] Saving connection to database...');
    const connection = await prisma.tellerConnection.upsert({
      where: { accountId: parsed.accountId },
      create: {
        accountId: parsed.accountId,
        tellerEnrollmentId: parsed.tellerEnrollmentId,
        tellerAccountId: parsed.tellerAccountId,
        tellerAccountName: parsed.tellerAccountName,
        tellerAccountType: parsed.tellerAccountType,
        tellerAccountSubtype: parsed.tellerAccountSubtype,
        tellerAccountLastFour: parsed.tellerAccountLastFour,
        status: 'connected',
      },
      update: {
        tellerEnrollmentId: parsed.tellerEnrollmentId,
        tellerAccountId: parsed.tellerAccountId,
        tellerAccountName: parsed.tellerAccountName,
        tellerAccountType: parsed.tellerAccountType,
        tellerAccountSubtype: parsed.tellerAccountSubtype,
        tellerAccountLastFour: parsed.tellerAccountLastFour,
        status: 'connected',
        lastSyncError: null,
      },
    });
    console.log('[Teller Connect API] Database save successful, connectionId:', connection.id);

    // Update account institution name
    console.log('[Teller Connect API] Updating account institution name...');
    await prisma.account.update({
      where: { id: parsed.accountId },
      data: { institution: enrollment.institutionName },
    });

    console.log('[Teller Connect API] Success! Returning response');
    return NextResponse.json({
      success: true,
      connectionId: connection.id,
    });
  } catch (error: unknown) {
    console.error('[Teller Connect API] ERROR:', error);
    if (error instanceof Error) {
      console.error('[Teller Connect API] Error message:', error.message);
      console.error('[Teller Connect API] Error stack:', error.stack);
    }
    const message = error instanceof Error ? error.message : 'Failed to connect';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
