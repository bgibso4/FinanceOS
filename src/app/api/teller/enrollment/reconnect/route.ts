import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptAccessToken } from '@/lib/encryption';

const reconnectSchema = z.object({
  enrollmentId: z.string(),
  accessToken: z.string(),
});

// POST: Re-authenticate an existing enrollment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Teller Reconnect API] Reconnecting enrollment:', body.enrollmentId);

    const parsed = reconnectSchema.parse(body);

    // Find the existing enrollment
    const enrollment = await prisma.tellerEnrollment.findUnique({
      where: { enrollmentId: parsed.enrollmentId },
    });

    if (!enrollment) {
      console.error('[Teller Reconnect API] Enrollment not found:', parsed.enrollmentId);
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    // Encrypt the new access token
    console.log('[Teller Reconnect API] Encrypting new access token...');
    const { encrypted, iv } = encryptAccessToken(parsed.accessToken);

    // Update the enrollment with new token and reset status
    console.log('[Teller Reconnect API] Updating enrollment...');
    const updatedEnrollment = await prisma.tellerEnrollment.update({
      where: { id: enrollment.id },
      data: {
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        status: 'connected',
      },
    });

    // Also update all related connections to connected status
    await prisma.tellerConnection.updateMany({
      where: { tellerEnrollmentId: enrollment.id },
      data: {
        status: 'connected',
        lastSyncError: null,
      },
    });

    console.log('[Teller Reconnect API] Enrollment reconnected successfully');

    return NextResponse.json({
      success: true,
      enrollment: {
        id: updatedEnrollment.id,
        enrollmentId: updatedEnrollment.enrollmentId,
        institutionName: updatedEnrollment.institutionName,
        status: updatedEnrollment.status,
      },
    });
  } catch (error: unknown) {
    console.error('[Teller Reconnect API] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to reconnect enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
