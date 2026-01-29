import https from 'https';
import fs from 'fs';
import path from 'path';
import { RateLimitError, TimeoutError } from '@/lib/sync-common';

const _TELLER_API_BASE = 'https://api.teller.io';

// Resolve relative paths from project root
function resolvePath(filePath: string): string {
  if (filePath.startsWith('/')) {
    return filePath;
  }
  // process.cwd() returns the project root in Next.js
  return path.resolve(process.cwd(), filePath);
}

type TellerEnv = 'sandbox' | 'development' | 'production';

function getTellerEnv(): TellerEnv {
  const env = process.env.TELLER_ENV || 'sandbox';
  if (env !== 'sandbox' && env !== 'development' && env !== 'production') {
    throw new Error('TELLER_ENV must be sandbox, development, or production');
  }
  return env;
}

function loadCertificate(): string {
  const cert = process.env.TELLER_CERTIFICATE;
  if (!cert) {
    throw new Error('TELLER_CERTIFICATE must be set');
  }

  // Check if it's a file path
  if (cert.startsWith('/') || cert.startsWith('./')) {
    return fs.readFileSync(resolvePath(cert), 'utf8');
  }

  // Check if it's base64 encoded
  if (!cert.includes('-----BEGIN')) {
    return Buffer.from(cert, 'base64').toString('utf8');
  }

  // It's a raw PEM string
  return cert;
}

function loadPrivateKey(): string {
  const key = process.env.TELLER_PRIVATE_KEY;
  if (!key) {
    throw new Error('TELLER_PRIVATE_KEY must be set');
  }

  // Check if it's a file path
  if (key.startsWith('/') || key.startsWith('./')) {
    return fs.readFileSync(resolvePath(key), 'utf8');
  }

  // Check if it's base64 encoded
  if (!key.includes('-----BEGIN')) {
    return Buffer.from(key, 'base64').toString('utf8');
  }

  // It's a raw PEM string
  return key;
}

export function getTellerApplicationId(): string {
  const appId = process.env.TELLER_APPLICATION_ID;
  if (!appId) {
    throw new Error('TELLER_APPLICATION_ID must be set');
  }
  return appId;
}

export async function tellerFetch<T>(
  apiPath: string,
  accessToken: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
    params?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params, signal } = options;

  let fullPath = apiPath;
  if (params) {
    const searchParams = new URLSearchParams(params);
    fullPath += `?${searchParams.toString()}`;
  }

  // Basic auth: access token as username, empty password
  const authHeader = 'Basic ' + Buffer.from(`${accessToken}:`).toString('base64');

  return new Promise((resolve, reject) => {
    // If already aborted, reject immediately
    if (signal?.aborted) {
      reject(new TimeoutError('Request aborted'));
      return;
    }

    const tellerEnv = getTellerEnv();

    // Build request options with mTLS for non-sandbox environments
    const requestOptions: https.RequestOptions = {
      hostname: 'api.teller.io',
      port: 443,
      path: fullPath,
      method,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    };

    // Add client certificate for mTLS in development/production
    if (tellerEnv !== 'sandbox') {
      requestOptions.cert = loadCertificate();
      requestOptions.key = loadPrivateKey();
    }

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Failed to parse response JSON'));
          }
        } else if (res.statusCode === 429) {
          // Rate limited — parse Retry-After header
          const retryAfter = res.headers['retry-after'];
          let retryAfterMs = 5000; // Default 5s if no header
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            retryAfterMs = isNaN(seconds) ? 5000 : seconds * 1000;
          }
          reject(new RateLimitError(`Teller API rate limited (429)`, retryAfterMs));
        } else {
          let errorMessage = `Teller API error: ${res.statusCode}`;
          try {
            const errorJson = JSON.parse(data);
            errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
          } catch {
            // Use default error message
          }
          reject(new Error(errorMessage));
        }
      });
    });

    // Handle abort signal
    const onAbort = () => {
      req.destroy();
      reject(new TimeoutError('Request timed out'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      // Don't double-reject if we already rejected from abort
      if (signal?.aborted) return;
      reject(new Error(`Teller API request failed: ${err.message}`));
    });

    req.on('close', () => {
      signal?.removeEventListener('abort', onAbort);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Teller API types
export type TellerAccount = {
  id: string;
  enrollment_id: string;
  institution: {
    id: string;
    name: string;
  };
  name: string;
  type: string;
  subtype: string;
  currency: string;
  last_four: string;
  status: string;
};

export type TellerTransaction = {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: string;
  status: 'pending' | 'posted';
  type: string;
  details: {
    category: string;
    counterparty: {
      name: string;
      type: string;
    };
    processing_status: string;
  };
};

export type TellerAccountsResponse = TellerAccount[];
export type TellerTransactionsResponse = TellerTransaction[];
