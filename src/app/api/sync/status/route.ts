import { NextResponse } from 'next/server';
import { getRecordCounts, getCloudMetadata } from '@/lib/cloud-sync';

export async function GET(request: Request) {
  try {
    // Get sync ID from query params (client passes this from local storage)
    const url = new URL(request.url);
    const syncId = url.searchParams.get('syncId');

    // Get local record counts
    const recordCounts = await getRecordCounts();

    // If no sync ID, return disabled status
    if (!syncId) {
      return NextResponse.json({
        enabled: false,
        syncId: null,
        lastSyncAt: null,
        status: 'disabled',
        pendingChanges: 0,
        recordCounts,
        cloudInfo: null,
      });
    }

    // Get cloud metadata
    let cloudInfo = null;
    try {
      cloudInfo = await getCloudMetadata(syncId);
    } catch {
      // Cloud might be unreachable
    }

    return NextResponse.json({
      enabled: true,
      syncId: syncId.slice(0, 8) + '...' + syncId.slice(-4), // Truncated for display
      lastSyncAt: cloudInfo?.lastModified || null,
      status: cloudInfo ? 'synced' : 'error',
      pendingChanges: 0,
      recordCounts,
      cloudInfo,
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
