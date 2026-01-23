import { http, HttpResponse } from 'msw';

const PLAID_SANDBOX_URL = 'https://sandbox.plaid.com';

// Sample mock data
export const mockPlaidAccounts = [
  {
    account_id: 'plaid-acc-001',
    name: 'Plaid Checking',
    type: 'depository',
    subtype: 'checking',
    mask: '0000',
    balances: {
      available: 1000,
      current: 1200,
      limit: null,
      iso_currency_code: 'USD',
    },
  },
  {
    account_id: 'plaid-acc-002',
    name: 'Plaid Credit Card',
    type: 'credit',
    subtype: 'credit card',
    mask: '1234',
    balances: {
      available: 2500,
      current: 500,
      limit: 3000,
      iso_currency_code: 'USD',
    },
  },
];

export const mockPlaidTransactions = [
  {
    transaction_id: 'plaid-txn-001',
    account_id: 'plaid-acc-001',
    amount: 89.42,
    date: '2024-01-15',
    name: "TRADER JOE'S #123",
    merchant_name: "Trader Joe's",
    category: ['Food and Drink', 'Groceries'],
    pending: false,
  },
  {
    transaction_id: 'plaid-txn-002',
    account_id: 'plaid-acc-001',
    amount: 24.5,
    date: '2024-01-14',
    name: 'UBER *TRIP',
    merchant_name: 'Uber',
    category: ['Travel', 'Rideshare'],
    pending: false,
  },
  {
    transaction_id: 'plaid-txn-003',
    account_id: 'plaid-acc-002',
    amount: 67.89,
    date: '2024-01-13',
    name: 'AMAZON.COM*ABC123',
    merchant_name: 'Amazon',
    category: ['Shopping'],
    pending: false,
  },
];

export const plaidHandlers = [
  // Link token creation
  http.post(`${PLAID_SANDBOX_URL}/link/token/create`, () => {
    return HttpResponse.json({
      link_token: 'link-sandbox-test-token-' + Date.now(),
      expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
      request_id: 'req-' + Date.now(),
    });
  }),

  // Public token exchange
  http.post(`${PLAID_SANDBOX_URL}/item/public_token/exchange`, () => {
    return HttpResponse.json({
      access_token: 'access-sandbox-' + Date.now(),
      item_id: 'item-sandbox-' + Date.now(),
      request_id: 'req-' + Date.now(),
    });
  }),

  // Accounts retrieval
  http.post(`${PLAID_SANDBOX_URL}/accounts/get`, () => {
    return HttpResponse.json({
      accounts: mockPlaidAccounts,
      item: {
        item_id: 'item-sandbox-test',
        institution_id: 'ins_109508',
        webhook: null,
      },
      request_id: 'req-' + Date.now(),
    });
  }),

  // Transactions sync
  http.post(`${PLAID_SANDBOX_URL}/transactions/sync`, () => {
    return HttpResponse.json({
      added: mockPlaidTransactions,
      modified: [],
      removed: [],
      has_more: false,
      next_cursor: 'cursor-' + Date.now(),
      accounts: mockPlaidAccounts,
      request_id: 'req-' + Date.now(),
    });
  }),

  // Item removal (disconnect)
  http.post(`${PLAID_SANDBOX_URL}/item/remove`, () => {
    return HttpResponse.json({
      request_id: 'req-' + Date.now(),
    });
  }),

  // Institution lookup
  http.post(`${PLAID_SANDBOX_URL}/institutions/get_by_id`, () => {
    return HttpResponse.json({
      institution: {
        institution_id: 'ins_109508',
        name: 'Chase',
        products: ['transactions', 'auth', 'identity'],
        country_codes: ['US'],
        url: 'https://www.chase.com',
        primary_color: '#0055a5',
        logo: null,
      },
      request_id: 'req-' + Date.now(),
    });
  }),
];

// Error response handlers for testing error scenarios
export const plaidErrorHandlers = {
  invalidToken: http.post(`${PLAID_SANDBOX_URL}/item/public_token/exchange`, () => {
    return HttpResponse.json(
      {
        error_type: 'INVALID_INPUT',
        error_code: 'INVALID_PUBLIC_TOKEN',
        error_message: 'The provided public token is invalid',
        display_message: 'Invalid token provided',
        request_id: 'req-error-' + Date.now(),
      },
      { status: 400 }
    );
  }),

  itemLoginRequired: http.post(`${PLAID_SANDBOX_URL}/transactions/sync`, () => {
    return HttpResponse.json(
      {
        error_type: 'ITEM_ERROR',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_message: 'The login credentials for this item have been updated',
        display_message: 'Please update your login credentials',
        request_id: 'req-error-' + Date.now(),
      },
      { status: 400 }
    );
  }),

  rateLimited: http.post(`${PLAID_SANDBOX_URL}/transactions/sync`, () => {
    return HttpResponse.json(
      {
        error_type: 'RATE_LIMIT_EXCEEDED',
        error_code: 'RATE_LIMIT_EXCEEDED',
        error_message: 'Rate limit exceeded',
        display_message: 'Too many requests',
        request_id: 'req-error-' + Date.now(),
      },
      { status: 429 }
    );
  }),
};
