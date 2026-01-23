import { createTransactionData, type TransactionData } from '../helpers/factories';

// Helper to create date relative to today
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0); // Normalize time
  return date;
}

export function createSampleTransactions(accountId: string): TransactionData[] {
  return [
    // Groceries
    createTransactionData(accountId, {
      id: 'txn-grocery-1',
      date: daysAgo(1),
      amount: -89.42,
      merchant: "TRADER JOE'S #123",
      merchantNormalized: "trader joe's",
      categoryId: 'cat-groceries',
      confidenceScore: 0.72,
    }),
    createTransactionData(accountId, {
      id: 'txn-grocery-2',
      date: daysAgo(5),
      amount: -156.78,
      merchant: 'WHOLE FOODS MARKET',
      merchantNormalized: 'whole foods market',
      categoryId: 'cat-groceries',
      confidenceScore: 0.72,
    }),

    // Restaurants
    createTransactionData(accountId, {
      id: 'txn-restaurant-1',
      date: daysAgo(2),
      amount: -45.0,
      merchant: 'SWEETGREEN NYC',
      merchantNormalized: 'sweetgreen',
      categoryId: 'cat-restaurants',
      confidenceScore: 0.98,
    }),

    // Rideshare
    createTransactionData(accountId, {
      id: 'txn-uber-1',
      date: daysAgo(3),
      amount: -24.5,
      merchant: 'UBER *TRIP',
      merchantNormalized: 'uber',
      categoryId: 'cat-rideshare',
      confidenceScore: 0.72,
    }),
    createTransactionData(accountId, {
      id: 'txn-lyft-1',
      date: daysAgo(4),
      amount: -18.75,
      merchant: 'LYFT *RIDE',
      merchantNormalized: 'lyft',
      categoryId: 'cat-rideshare',
      confidenceScore: 0.72,
    }),

    // Entertainment
    createTransactionData(accountId, {
      id: 'txn-netflix-1',
      date: daysAgo(10),
      amount: -15.99,
      merchant: 'NETFLIX.COM',
      merchantNormalized: 'netflix',
      categoryId: 'cat-entertainment',
      confidenceScore: 0.72,
    }),
    createTransactionData(accountId, {
      id: 'txn-spotify-1',
      date: daysAgo(10),
      amount: -9.99,
      merchant: 'SPOTIFY USA',
      merchantNormalized: 'spotify',
      categoryId: 'cat-entertainment',
      confidenceScore: 0.72,
    }),

    // Shopping
    createTransactionData(accountId, {
      id: 'txn-amazon-1',
      date: daysAgo(6),
      amount: -67.89,
      merchant: 'AMAZON.COM*ABC123',
      merchantNormalized: 'amazon',
      categoryId: 'cat-shopping',
      confidenceScore: 0.72,
    }),

    // Uncategorized
    createTransactionData(accountId, {
      id: 'txn-uncategorized-1',
      date: daysAgo(2),
      amount: -35.0,
      merchant: 'UNKNOWN MERCHANT',
      merchantNormalized: 'unknown merchant',
      categoryId: undefined,
      confidenceScore: 0.3,
    }),

    // Income
    createTransactionData(accountId, {
      id: 'txn-salary-1',
      date: daysAgo(15),
      amount: 5000.0,
      merchant: 'EMPLOYER DIRECT DEP',
      merchantNormalized: 'employer',
      categoryId: 'cat-salary',
      confidenceScore: 1.0,
    }),
  ];
}

// Transactions specifically for testing returns/offsets
export function createReturnTransactions(accountId: string): TransactionData[] {
  return [
    // Original purchase
    createTransactionData(accountId, {
      id: 'txn-purchase-1',
      date: daysAgo(10),
      amount: -100.0,
      merchant: 'AMAZON.COM',
      merchantNormalized: 'amazon',
      categoryId: 'cat-shopping',
    }),
    // Return for the purchase
    createTransactionData(accountId, {
      id: 'txn-return-1',
      date: daysAgo(5),
      amount: 100.0,
      merchant: 'AMAZON.COM REFUND',
      merchantNormalized: 'amazon',
      categoryId: 'cat-shopping',
    }),
    // Partial return
    createTransactionData(accountId, {
      id: 'txn-purchase-2',
      date: daysAgo(8),
      amount: -75.0,
      merchant: 'TARGET',
      merchantNormalized: 'target',
      categoryId: 'cat-shopping',
    }),
    createTransactionData(accountId, {
      id: 'txn-return-2',
      date: daysAgo(3),
      amount: 50.0,
      merchant: 'TARGET RETURN',
      merchantNormalized: 'target',
      categoryId: 'cat-shopping',
    }),
  ];
}

// Transactions for transfer detection
export function createTransferTransactions(
  account1Id: string,
  account2Id: string
): TransactionData[] {
  const transferDate = daysAgo(7);
  return [
    createTransactionData(account1Id, {
      id: 'txn-transfer-out',
      date: transferDate,
      amount: -500.0,
      merchant: 'TRANSFER TO SAVINGS',
      merchantNormalized: 'transfer',
      isTransfer: true,
      transferGroupId: 'transfer-group-1',
    }),
    createTransactionData(account2Id, {
      id: 'txn-transfer-in',
      date: transferDate,
      amount: 500.0,
      merchant: 'TRANSFER FROM CHECKING',
      merchantNormalized: 'transfer',
      isTransfer: true,
      transferGroupId: 'transfer-group-1',
    }),
  ];
}

// Low confidence transactions for review queue
export function createLowConfidenceTransactions(accountId: string): TransactionData[] {
  return [
    createTransactionData(accountId, {
      id: 'txn-low-conf-1',
      date: daysAgo(1),
      amount: -42.0,
      merchant: 'NEW PLACE',
      confidenceScore: 0.45,
      categoryId: 'cat-restaurants',
    }),
    createTransactionData(accountId, {
      id: 'txn-low-conf-2',
      date: daysAgo(2),
      amount: -28.0,
      merchant: 'RANDOM STORE',
      confidenceScore: 0.3,
      categoryId: undefined,
    }),
  ];
}

// Outlier transactions (unusually high amounts)
export function createOutlierTransactions(accountId: string): TransactionData[] {
  // First create 5 normal transactions to establish baseline
  const normal = Array.from({ length: 5 }, (_, i) =>
    createTransactionData(accountId, {
      id: `txn-normal-${i}`,
      date: daysAgo(i + 1),
      amount: -25.0, // Normal amount
      merchant: `RESTAURANT ${i}`,
      categoryId: 'cat-restaurants',
      confidenceScore: 0.98,
    })
  );

  // Then an outlier
  const outlier = createTransactionData(accountId, {
    id: 'txn-outlier-1',
    date: daysAgo(0),
    amount: -350.0, // Way above median of $25
    merchant: 'FANCY RESTAURANT',
    categoryId: 'cat-restaurants',
    confidenceScore: 0.98,
  });

  return [...normal, outlier];
}
