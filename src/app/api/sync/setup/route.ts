import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  exportDatabase,
  encrypt,
  uploadBlob,
  hashPassphrase,
  getRecordCounts,
} from '@/lib/cloud-sync';

const SetupRequestSchema = z.object({
  passphrase: z.string().min(8, 'Passphrase must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { passphrase } = SetupRequestSchema.parse(body);

    // Generate new sync ID
    const syncId = crypto.randomUUID();

    // Export and encrypt database
    const payload = await exportDatabase();
    const blob = await encrypt(payload, passphrase);

    // Upload to R2
    await uploadBlob(syncId, blob);

    // Get record counts for response
    const recordCounts = await getRecordCounts();

    // Hash passphrase for local storage (client will store this)
    const passphraseHash = await hashPassphrase(passphrase);

    return NextResponse.json({
      syncId,
      setupAt: new Date().toISOString(),
      passphraseHash,
      recordCounts,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    console.error('Sync setup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Setup failed' },
      { status: 500 }
    );
  }
}
