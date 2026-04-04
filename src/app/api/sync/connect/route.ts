import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { downloadBlob, decrypt, importDatabase, getRecordCounts } from '@/lib/cloud-sync';

const ConnectRequestSchema = z.object({
  syncId: z.string().uuid('Invalid sync ID format'),
});

export async function POST(request: NextRequest) {
  try {
    if (!process.env.SYNC_ENCRYPTION_KEY) {
      return NextResponse.json(
        { error: 'SYNC_ENCRYPTION_KEY not configured on server' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { syncId } = ConnectRequestSchema.parse(body);

    // Download encrypted blob
    const blob = await downloadBlob(syncId);

    // Decrypt with server key
    const payload = await decrypt(blob);

    // Import into database
    await importDatabase(payload);

    // Get updated record counts
    const recordCounts = await getRecordCounts();

    return NextResponse.json({
      success: true,
      connectedAt: new Date().toISOString(),
      restored: {
        accounts: recordCounts.accounts,
        transactions: recordCounts.transactions,
        categories: recordCounts.categories,
        rules: recordCounts.rules,
        budgets: recordCounts.budgets,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    // Check for specific error types
    const errorMessage = error instanceof Error ? error.message : 'Connection failed';

    if (
      errorMessage.includes('key') ||
      errorMessage.includes('decrypt') ||
      errorMessage.includes('Decryption')
    ) {
      return NextResponse.json(
        { error: 'Decryption failed — wrong encryption key' },
        { status: 401 }
      );
    }

    if (errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND')) {
      return NextResponse.json({ error: 'Sync ID not found' }, { status: 404 });
    }

    console.error('Sync connect error:', error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
