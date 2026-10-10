import { Configuration, PlaidApi, PlaidEnvironments, Products } from 'plaid';

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

export type PlaidLinkKind = 'banking' | 'investments';

/**
 * Product arrays for a new-connection link token. Plaid hides accounts that don't support
 * every product in `products`, so brokerage/IRA/401k/HSA accounts need Investments there,
 * with Transactions optional to still pick up any cash activity the institution exposes.
 */
export function linkProductsFor(kind: PlaidLinkKind): {
  products: Products[];
  optional_products?: Products[];
} {
  if (kind === 'investments') {
    return { products: [Products.Investments], optional_products: [Products.Transactions] };
  }
  return { products: [Products.Transactions] };
}
