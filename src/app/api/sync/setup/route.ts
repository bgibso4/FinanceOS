import { NextResponse } from 'next/server';
import { exportDatabase, encrypt, uploadBlob, getRecordCounts } from '@/lib/cloud-sync';

export async function POST() {
  try {
    if (!process.env.SYNC_ENCRYPTION_KEY) {
      return NextResponse.json(
        { error: 'SYNC_ENCRYPTION_KEY not configured on server' },
        { status: 500 }
      );
    }

    // Generate new sync ID
    const syncId = crypto.randomUUID();

    // Export and encrypt database
    const payload = await exportDatabase();
    const blob = await encrypt(payload);

    // Upload to R2
    await uploadBlob(syncId, blob);

    // Get record counts for response
    const recordCounts = await getRecordCounts();

    return NextResponse.json({
      syncId,
      setupAt: new Date().toISOString(),
      recordCounts,
    });
  } catch (error) {
    console.error('Sync setup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Setup failed' },
      { status: 500 }
    );
  }
}
