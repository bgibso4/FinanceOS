import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptAccessToken } from '@/lib/encryption';
import { tellerFetch, TellerAccountsResponse } from '@/lib/teller';

const createEnrollmentSchema = z.object({
  accessToken: z.string(),
  enrollmentId: z.string(),
  institutionId: z.string(),
  institutionName: z.string(),
});

// GET: Fetch all Teller enrollments
export async function GET() {
  try {
    const enrollments = await prisma.tellerEnrollment.findMany({
      include: {
        connections: {
          include: {
            account: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // For each enrollment, fetch available accounts from Teller
    const enrollmentsWithAccounts = await Promise.all(
      enrollments.map(async (enrollment) => {
        try {
          const { decryptAccessToken } = await import('@/lib/encryption');
          const accessToken = decryptAccessToken(
            enrollment.accessTokenEncrypted,
            enrollment.accessTokenIv
          );

          const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', accessToken);

          return {
            ...enrollment,
            availableAccounts: accounts,
            totalAccountCount: accounts.length,
          };
        } catch (error) {
          console.error(`Error fetching accounts for enrollment ${enrollment.id}:`, error);

          // Check if this is an auth error and update the enrollment status
          const errorMessage = error instanceof Error ? error.message : '';
          const isAuthError =
            errorMessage.includes('401') ||
            errorMessage.toLowerCase().includes('unauthorized') ||
            errorMessage.toLowerCase().includes('authentication');

          if (isAuthError && enrollment.status !== 'disconnected') {
            // Update status in background (don't await to keep response fast)
            prisma.tellerEnrollment
              .update({
                where: { id: enrollment.id },
                data: { status: 'disconnected' },
              })
              .catch((e) => console.error('Failed to update enrollment status:', e));

            return {
              ...enrollment,
              status: 'disconnected', // Return updated status immediately
              availableAccounts: [],
            };
          }

          return {
            ...enrollment,
            availableAccounts: [],
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      enrollments: enrollmentsWithAccounts,
    });
  } catch (error: unknown) {
    console.error('[Teller Enrollment API GET] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch enrollments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Create a new Teller enrollment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Teller Enrollment API] Creating enrollment:', {
      enrollmentId: body.enrollmentId,
      institutionId: body.institutionId,
      institutionName: body.institutionName,
      hasAccessToken: !!body.accessToken,
    });

    const parsed = createEnrollmentSchema.parse(body);

    // Check if enrollment already exists
    const existing = await prisma.tellerEnrollment.findUnique({
      where: { enrollmentId: parsed.enrollmentId },
    });

    if (existing) {
      console.log('[Teller Enrollment API] Enrollment already exists');
      return NextResponse.json({
        success: true,
        enrollment: existing,
        existed: true,
      });
    }

    // Encrypt the access token
    console.log('[Teller Enrollment API] Encrypting access token...');
    const { encrypted, iv } = encryptAccessToken(parsed.accessToken);

    // Create enrollment
    console.log('[Teller Enrollment API] Saving enrollment to database...');
    const enrollment = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: parsed.enrollmentId,
        institutionId: parsed.institutionId,
        institutionName: parsed.institutionName,
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        status: 'connected',
      },
    });

    console.log('[Teller Enrollment API] Enrollment created successfully:', enrollment.id);

    return NextResponse.json({
      success: true,
      enrollment,
      existed: false,
    });
  } catch (error: unknown) {
    console.error('[Teller Enrollment API POST] ERROR:', error);
    if (error instanceof Error) {
      console.error('[Teller Enrollment API POST] Error message:', error.message);
      console.error('[Teller Enrollment API POST] Error stack:', error.stack);
    }
    const message = error instanceof Error ? error.message : 'Failed to create enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: Remove an enrollment and all its connections
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const enrollmentId = searchParams.get('id');

    if (!enrollmentId) {
      return NextResponse.json({ error: 'Enrollment ID required' }, { status: 400 });
    }

    console.log('[Teller Enrollment API] Deleting enrollment:', enrollmentId);

    // Check if enrollment exists first for idempotency
    const existing = await prisma.tellerEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!existing) {
      // Already deleted - return success for idempotency
      console.log('[Teller Enrollment API] Enrollment already deleted');
      return NextResponse.json({ success: true, alreadyDeleted: true });
    }

    await prisma.tellerEnrollment.delete({
      where: { id: enrollmentId },
    });

    console.log('[Teller Enrollment API] Enrollment deleted successfully');

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[Teller Enrollment API DELETE] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
