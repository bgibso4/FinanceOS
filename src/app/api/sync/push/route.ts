import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { exportDatabase, encrypt, uploadBlob, getRecordCounts } from '@/lib/cloud-sync';

const PushRequestSchema = z.object({
  syncId: z.string().uuid('Invalid sync ID format'),
  passphrase: z.string().min(1, 'Passphrase is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncId, passphrase } = PushRequestSchema.parse(body);

    // Export database
    const payload = await exportDatabase();

    // Encrypt
    const blob = await encrypt(payload, passphrase);

    // Upload to R2
    const result = await uploadBlob(syncId, blob);

    // Get record counts
    const recordCounts = await getRecordCounts();

    return NextResponse.json({
      success: true,
      uploadedAt: result.uploadedAt,
      blobSize: result.size,
      recordCounts,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    console.error('Sync push error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Push failed' },
      { status: 500 }
    );
  }
}
