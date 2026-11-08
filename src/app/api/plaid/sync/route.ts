import { getInvestmentServices } from '@/lib/investments/services';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ConnectionSyncError, syncPlaidConnection } from '@/lib/connection-sync';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const { accountId, daysToSync, dryRun } = schema.parse(await req.json());
    const outcome = await syncPlaidConnection(accountId, { daysToSync, dryRun });

    if (outcome.investments?.length) {
      // Pricing is one throttled Yahoo call per stale symbol: run it after responding, never
      // failing the sync. The investments view's refresh call covers anything missed.
      void getInvestmentServices()
        .then(({ refresh }) => refresh.refresh())
        .catch((error) => console.error('[investments] post-sync refresh failed:', error));
    }

    return NextResponse.json(outcome);
  } catch (error: unknown) {
    if (error instanceof ConnectionSyncError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error('Error syncing transactions:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
