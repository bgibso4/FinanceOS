/**
 * R2 Client
 *
 * Handles communication with the Cloudflare Worker for R2 operations.
 */

const WORKER_URL = process.env.NEXT_PUBLIC_SYNC_WORKER_URL || 'http://localhost:8787';

export interface CloudMetadata {
  exists: boolean;
  size?: number;
  lastModified?: string;
}

export interface UploadResult {
  success: boolean;
  key: string;
  size: number;
  uploadedAt: string;
}

export class R2ClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: 'NETWORK' | 'NOT_FOUND' | 'INVALID_REQUEST' | 'SERVER_ERROR'
  ) {
    super(message);
    this.name = 'R2ClientError';
  }
}

/**
 * Check health of the sync worker
 */
export async function checkWorkerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKER_URL}/health`, {
      method: 'GET',
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Get metadata for a sync blob (to check if cloud is newer)
 */
export async function getCloudMetadata(syncId: string): Promise<CloudMetadata> {
  try {
    const response = await fetch(`${WORKER_URL}/metadata?syncId=${encodeURIComponent(syncId)}`, {
      method: 'GET',
    });

    if (!response.ok) {
      if (response.status === 400) {
        throw new R2ClientError('Invalid sync ID', 400, 'INVALID_REQUEST');
      }
      throw new R2ClientError(`Server error: ${response.status}`, response.status, 'SERVER_ERROR');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof R2ClientError) throw error;
    throw new R2ClientError('Network error connecting to sync service', 0, 'NETWORK');
  }
}

/**
 * Upload an encrypted blob to R2
 */
export async function uploadBlob(syncId: string, blob: ArrayBuffer): Promise<UploadResult> {
  try {
    const response = await fetch(
      `${WORKER_URL}/upload?syncId=${encodeURIComponent(syncId)}&file=current.enc`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: blob,
      }
    );

    if (!response.ok) {
      if (response.status === 400) {
        const error = await response.json();
        throw new R2ClientError(error.error || 'Invalid request', 400, 'INVALID_REQUEST');
      }
      throw new R2ClientError(`Upload failed: ${response.status}`, response.status, 'SERVER_ERROR');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof R2ClientError) throw error;
    throw new R2ClientError('Network error during upload', 0, 'NETWORK');
  }
}

/**
 * Download an encrypted blob from R2
 */
export async function downloadBlob(
  syncId: string,
  file: 'current.enc' | 'previous.enc' = 'current.enc'
): Promise<ArrayBuffer> {
  try {
    const response = await fetch(
      `${WORKER_URL}/download?syncId=${encodeURIComponent(syncId)}&file=${file}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new R2ClientError('Sync data not found', 404, 'NOT_FOUND');
      }
      if (response.status === 400) {
        const error = await response.json();
        throw new R2ClientError(error.error || 'Invalid request', 400, 'INVALID_REQUEST');
      }
      throw new R2ClientError(
        `Download failed: ${response.status}`,
        response.status,
        'SERVER_ERROR'
      );
    }

    return await response.arrayBuffer();
  } catch (error) {
    if (error instanceof R2ClientError) throw error;
    throw new R2ClientError('Network error during download', 0, 'NETWORK');
  }
}

/**
 * Check if cloud data exists for a sync ID
 */
export async function cloudDataExists(syncId: string): Promise<boolean> {
  const metadata = await getCloudMetadata(syncId);
  return metadata.exists;
}

/**
 * Check if cloud data is newer than local
 */
export async function isCloudNewer(
  syncId: string,
  localTimestamp: string | null
): Promise<boolean> {
  if (!localTimestamp) return true; // No local data, cloud is "newer"

  const metadata = await getCloudMetadata(syncId);
  if (!metadata.exists || !metadata.lastModified) return false;

  const cloudDate = new Date(metadata.lastModified);
  const localDate = new Date(localTimestamp);

  return cloudDate > localDate;
}
