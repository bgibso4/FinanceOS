import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ConnectionSyncError, syncTellerConnection } from '@/lib/connection-sync';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  includePending: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const { accountId, ...opts } = schema.parse(await req.json());
    return NextResponse.json(await syncTellerConnection(accountId, opts));
  } catch (error: unknown) {
    if (error instanceof ConnectionSyncError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error('Error syncing Teller transactions:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
