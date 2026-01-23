import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

let plaidClient: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (plaidClient) return plaidClient;

  const env = process.env.PLAID_ENV || 'sandbox';

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    throw new Error('PLAID_CLIENT_ID and PLAID_SECRET must be set');
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });

  plaidClient = new PlaidApi(configuration);
  return plaidClient;
}
