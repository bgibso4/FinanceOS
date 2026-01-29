/**
 * Cloudflare Worker for FinanceOS Cloud Sync
 *
 * Provides presigned URLs for R2 upload/download.
 * Security is handled by:
 * 1. Unguessable sync ID (128-bit UUID)
 * 2. Client-side AES-256-GCM encryption
 */

interface Env {
  SYNC_BUCKET: R2Bucket;
  ALLOWED_ORIGINS: string;
}

interface PresignRequest {
  syncId: string;
  operation: 'upload' | 'download';
  file: 'current.enc' | 'previous.enc';
}

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function getCorsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

  const headers = new Headers(CORS_HEADERS);

  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function jsonResponse(data: unknown, status: number, corsHeaders: Headers): Response {
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers });
}

function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = getCorsHeaders(request, env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse(
        {
          status: 'ok',
          timestamp: new Date().toISOString(),
        },
        200,
        corsHeaders
      );
    }

    // Generate presigned URL for upload/download
    if (url.pathname === '/presign' && request.method === 'POST') {
      try {
        const body = (await request.json()) as PresignRequest;
        const { syncId, operation, file } = body;

        // Validate inputs
        if (!syncId || !isValidUUID(syncId)) {
          return jsonResponse({ error: 'Invalid sync ID' }, 400, corsHeaders);
        }

        if (!['upload', 'download'].includes(operation)) {
          return jsonResponse({ error: 'Invalid operation' }, 400, corsHeaders);
        }

        if (!['current.enc', 'previous.enc'].includes(file)) {
          return jsonResponse({ error: 'Invalid file' }, 400, corsHeaders);
        }

        const key = `${syncId}/${file}`;

        if (operation === 'download') {
          // Check if file exists
          const object = await env.SYNC_BUCKET.head(key);
          if (!object) {
            return jsonResponse({ error: 'File not found' }, 404, corsHeaders);
          }

          // For download, we return the object directly since R2 doesn't support presigned URLs
          // The client will call a separate download endpoint
          return jsonResponse(
            {
              exists: true,
              size: object.size,
              lastModified: object.uploaded.toISOString(),
              downloadUrl: `/download?syncId=${syncId}&file=${file}`,
            },
            200,
            corsHeaders
          );
        }

        // For upload, return the upload endpoint
        return jsonResponse(
          {
            uploadUrl: `/upload?syncId=${syncId}&file=${file}`,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          },
          200,
          corsHeaders
        );
      } catch {
        return jsonResponse({ error: 'Invalid request body' }, 400, corsHeaders);
      }
    }

    // Upload endpoint
    if (url.pathname === '/upload' && request.method === 'PUT') {
      const syncId = url.searchParams.get('syncId');
      const file = url.searchParams.get('file');

      if (!syncId || !isValidUUID(syncId)) {
        return jsonResponse({ error: 'Invalid sync ID' }, 400, corsHeaders);
      }

      if (!file || !['current.enc', 'previous.enc'].includes(file)) {
        return jsonResponse({ error: 'Invalid file' }, 400, corsHeaders);
      }

      const key = `${syncId}/${file}`;

      // If uploading current.enc, first rotate existing to previous.enc
      if (file === 'current.enc') {
        const existing = await env.SYNC_BUCKET.get(key);
        if (existing) {
          await env.SYNC_BUCKET.put(`${syncId}/previous.enc`, existing.body);
        }
      }

      // Upload the new file
      const body = await request.arrayBuffer();
      await env.SYNC_BUCKET.put(key, body, {
        httpMetadata: {
          contentType: 'application/octet-stream',
        },
      });

      return jsonResponse(
        {
          success: true,
          key,
          size: body.byteLength,
          uploadedAt: new Date().toISOString(),
        },
        200,
        corsHeaders
      );
    }

    // Download endpoint
    if (url.pathname === '/download' && request.method === 'GET') {
      const syncId = url.searchParams.get('syncId');
      const file = url.searchParams.get('file');

      if (!syncId || !isValidUUID(syncId)) {
        return jsonResponse({ error: 'Invalid sync ID' }, 400, corsHeaders);
      }

      if (!file || !['current.enc', 'previous.enc'].includes(file)) {
        return jsonResponse({ error: 'Invalid file' }, 400, corsHeaders);
      }

      const key = `${syncId}/${file}`;
      const object = await env.SYNC_BUCKET.get(key);

      if (!object) {
        return jsonResponse({ error: 'File not found' }, 404, corsHeaders);
      }

      const headers = new Headers(corsHeaders);
      headers.set('Content-Type', 'application/octet-stream');
      headers.set('Content-Length', object.size.toString());
      headers.set('Last-Modified', object.uploaded.toISOString());

      return new Response(object.body, { status: 200, headers });
    }

    // Get metadata (for checking if cloud is newer)
    if (url.pathname === '/metadata' && request.method === 'GET') {
      const syncId = url.searchParams.get('syncId');

      if (!syncId || !isValidUUID(syncId)) {
        return jsonResponse({ error: 'Invalid sync ID' }, 400, corsHeaders);
      }

      const key = `${syncId}/current.enc`;
      const object = await env.SYNC_BUCKET.head(key);

      if (!object) {
        return jsonResponse({ exists: false }, 200, corsHeaders);
      }

      return jsonResponse(
        {
          exists: true,
          size: object.size,
          lastModified: object.uploaded.toISOString(),
        },
        200,
        corsHeaders
      );
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  },
};
