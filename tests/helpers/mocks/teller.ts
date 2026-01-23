import { http, HttpResponse } from 'msw';

const TELLER_API_URL = 'https://api.teller.io';

// Sample mock data
export const mockTellerAccounts = [
  {
    id: 'teller-acc-001',
    name: 'Checking Account',
    type: 'depository',
    subtype: 'checking',
    currency: 'USD',
    last_four: '1234',
    status: 'open',
    enrollment_id: 'enr-001',
    institution: {
      id: 'chase',
      name: 'Chase',
    },
  },
  {
    id: 'teller-acc-002',
    name: 'Savings Account',
    type: 'depository',
    subtype: 'savings',
    currency: 'USD',
    last_four: '5678',
    status: 'open',
    enrollment_id: 'enr-001',
    institution: {
      id: 'chase',
      name: 'Chase',
    },
  },
];

export const mockTellerBalances = [
  {
    account_id: 'teller-acc-001',
    available: '2500.00',
    ledger: '2500.00',
  },
  {
    account_id: 'teller-acc-002',
    available: '10000.00',
    ledger: '10000.00',
  },
];

export const mockTellerTransactions = [
  {
    id: 'teller-txn-001',
    account_id: 'teller-acc-001',
    amount: '-89.42',
    date: '2024-01-15',
    description: "TRADER JOE'S #123",
    details: {
      category: 'shopping',
      counterparty: {
        name: "Trader Joe's",
        type: 'merchant',
      },
      processing_status: 'complete',
    },
    status: 'posted',
    type: 'card_payment',
  },
  {
    id: 'teller-txn-002',
    account_id: 'teller-acc-001',
    amount: '-24.50',
    date: '2024-01-14',
    description: 'UBER *TRIP',
    details: {
      category: 'transportation',
      counterparty: {
        name: 'Uber',
        type: 'merchant',
      },
      processing_status: 'complete',
    },
    status: 'posted',
    type: 'card_payment',
  },
  {
    id: 'teller-txn-003',
    account_id: 'teller-acc-001',
    amount: '5000.00',
    date: '2024-01-10',
    description: 'EMPLOYER DIRECT DEP',
    details: {
      category: 'income',
      counterparty: {
        name: 'Employer Inc',
        type: 'organization',
      },
      processing_status: 'complete',
    },
    status: 'posted',
    type: 'ach',
  },
];

export const tellerHandlers = [
  // List accounts for an enrollment
  http.get(`${TELLER_API_URL}/accounts`, () => {
    return HttpResponse.json(mockTellerAccounts);
  }),

  // Get single account
  http.get(`${TELLER_API_URL}/accounts/:accountId`, ({ params }) => {
    const account = mockTellerAccounts.find((a) => a.id === params.accountId);
    if (!account) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'Account not found' } },
        { status: 404 }
      );
    }
    return HttpResponse.json(account);
  }),

  // Get account balances
  http.get(`${TELLER_API_URL}/accounts/:accountId/balances`, ({ params }) => {
    const balance = mockTellerBalances.find((b) => b.account_id === params.accountId);
    if (!balance) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'Account not found' } },
        { status: 404 }
      );
    }
    return HttpResponse.json(balance);
  }),

  // List transactions for an account
  http.get(`${TELLER_API_URL}/accounts/:accountId/transactions`, ({ params, request }) => {
    const url = new URL(request.url);
    const fromDate = url.searchParams.get('from_date');
    const count = parseInt(url.searchParams.get('count') || '100', 10);

    let transactions = mockTellerTransactions.filter((t) => t.account_id === params.accountId);

    // Apply from_date filter if provided
    if (fromDate) {
      transactions = transactions.filter((t) => t.date >= fromDate);
    }

    // Apply count limit
    transactions = transactions.slice(0, count);

    return HttpResponse.json(transactions);
  }),

  // Get single transaction
  http.get(`${TELLER_API_URL}/accounts/:accountId/transactions/:transactionId`, ({ params }) => {
    const transaction = mockTellerTransactions.find(
      (t) => t.id === params.transactionId && t.account_id === params.accountId
    );
    if (!transaction) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'Transaction not found' } },
        { status: 404 }
      );
    }
    return HttpResponse.json(transaction);
  }),

  // Delete enrollment (disconnect)
  http.delete(`${TELLER_API_URL}/enrollments/:enrollmentId`, () => {
    return new HttpResponse(null, { status: 204 });
  }),
];

// Error response handlers for testing error scenarios
export const tellerErrorHandlers = {
  unauthorized: http.get(`${TELLER_API_URL}/accounts`, () => {
    return HttpResponse.json(
      { error: { code: 'unauthorized', message: 'Invalid or expired access token' } },
      { status: 401 }
    );
  }),

  disconnected: http.get(`${TELLER_API_URL}/accounts/:accountId/transactions`, () => {
    return HttpResponse.json(
      {
        error: {
          code: 'enrollment.disconnected',
          message: 'The enrollment has been disconnected',
        },
      },
      { status: 403 }
    );
  }),

  rateLimited: http.get(`${TELLER_API_URL}/accounts`, () => {
    return HttpResponse.json(
      { error: { code: 'rate_limit', message: 'Rate limit exceeded' } },
      { status: 429 }
    );
  }),
};
