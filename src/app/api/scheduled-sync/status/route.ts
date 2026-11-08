import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readPassRecord } from '@/lib/scheduled-sync/record';
import { PASS_EVERY_MS, scheduledSyncEnabled } from '@/lib/scheduled-sync/schedule';

const NEEDS_ATTENTION = { in: ['needs_reauth', 'disconnected'] };

export async function GET() {
  try {
    const [record, plaid, teller] = await Promise.all([
      readPassRecord(prisma),
      prisma.plaidConnection.count({ where: { status: NEEDS_ATTENTION } }),
      prisma.tellerConnection.count({ where: { status: NEEDS_ATTENTION } }),
    ]);
    const failedSteps = record?.failures ?? [];
    return NextResponse.json({
      enabled: scheduledSyncEnabled(),
      lastFinishedAt: record?.finishedAt.toISOString() ?? null,
      nextAround: record
        ? new Date(record.finishedAt.getTime() + PASS_EVERY_MS).toISOString()
        : null,
      failedSteps,
      needsAttention: plaid + teller > 0 || failedSteps.length > 0,
    });
  } catch (error) {
    console.error('Failed to read scheduled sync status:', error);
    return NextResponse.json({ error: 'Failed to read scheduled sync status' }, { status: 500 });
  }
}
