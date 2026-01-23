import https from 'https';
import fs from 'fs';

const TELLER_API_BASE = 'https://api.teller.io';

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
    return fs.readFileSync(cert, 'utf8');
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
    return fs.readFileSync(key, 'utf8');
  }

  // Check if it's base64 encoded
  if (!key.includes('-----BEGIN')) {
    return Buffer.from(key, 'base64').toString('utf8');
  }

  // It's a raw PEM string
  return key;
}

let httpsAgent: https.Agent | null = null;

function getHttpsAgent(): https.Agent {
  if (httpsAgent) return httpsAgent;

  const tellerEnv = getTellerEnv();

  // Sandbox mode doesn't require mTLS
  if (tellerEnv === 'sandbox') {
    httpsAgent = new https.Agent();
    return httpsAgent;
  }

  const cert = loadCertificate();
  const key = loadPrivateKey();

  httpsAgent = new https.Agent({
    cert,
    key,
  });

  return httpsAgent;
}

export function getTellerApplicationId(): string {
  const appId = process.env.TELLER_APPLICATION_ID;
  if (!appId) {
    throw new Error('TELLER_APPLICATION_ID must be set');
  }
  return appId;
}

export async function tellerFetch<T>(
  path: string,
  accessToken: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params } = options;

  let url = `${TELLER_API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  // Basic auth: access token as username, empty password
  const authHeader = 'Basic ' + Buffer.from(`${accessToken}:`).toString('base64');

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    // @ts-expect-error - Node.js fetch supports agent option
    agent: getHttpsAgent(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = `Teller API error: ${response.status}`;
    try {
      const errorJson = JSON.parse(errorBody);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  return response.json();
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
