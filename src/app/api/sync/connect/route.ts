import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  downloadBlob,
  decrypt,
  importDatabase,
  hashPassphrase,
  getRecordCounts,
} from '@/lib/cloud-sync';

const ConnectRequestSchema = z.object({
  syncId: z.string().uuid('Invalid sync ID format'),
  passphrase: z.string().min(1, 'Passphrase is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncId, passphrase } = ConnectRequestSchema.parse(body);

    // Download encrypted blob
    const blob = await downloadBlob(syncId);

    // Decrypt (this validates the passphrase)
    const payload = await decrypt(blob, passphrase);

    // Import into database
    await importDatabase(payload);

    // Get updated record counts
    const recordCounts = await getRecordCounts();

    // Hash passphrase for local storage
    const passphraseHash = await hashPassphrase(passphrase);

    return NextResponse.json({
      success: true,
      connectedAt: new Date().toISOString(),
      passphraseHash,
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

    if (errorMessage.includes('passphrase') || errorMessage.includes('decrypt')) {
      return NextResponse.json({ error: 'Incorrect passphrase' }, { status: 401 });
    }

    if (errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND')) {
      return NextResponse.json({ error: 'Sync ID not found' }, { status: 404 });
    }

    console.error('Sync connect error:', error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
