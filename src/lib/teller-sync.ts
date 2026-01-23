import { prisma } from '@/lib/prisma';
import { tellerFetch, TellerTransaction, TellerTransactionsResponse } from '@/lib/teller';
import { decryptAccessToken } from '@/lib/encryption';
import { autoCategorize, normalizeMerchant, resolveCategoryId } from '@/lib/categorization';

type TellerConnectionWithAccount = {
  id: string;
  accountId: string;
  tellerEnrollmentId: string;
  tellerAccountId: string;
  lastSyncDate: string | null;
  account: { id: string; name: string };
  tellerEnrollment: {
    id: string;
    accessTokenEncrypted: string;
    accessTokenIv: string;
  };
};

export type SyncResult = {
  added: number;
  modified: number;
  removed: number;
  skippedDuplicates: number;
  skippedPending: number;
  skippedOld: number;
  autoCategorized: number;
};

type SyncOptions = {
  daysToSync?: number;
  includePending?: boolean;
};

export async function syncTellerTransactions(
  connection: TellerConnectionWithAccount,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const { daysToSync = 30, includePending = false } = options;

  const accessToken = decryptAccessToken(
    connection.tellerEnrollment.accessTokenEncrypted,
    connection.tellerEnrollment.accessTokenIv
  );

  // Calculate date range
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysToSync);

  const fromDateStr = formatDateForTeller(fromDate);
  const toDateStr = formatDateForTeller(toDate);

  const stats: SyncResult = {
    added: 0,
    modified: 0,
    removed: 0,
    skippedDuplicates: 0,
    skippedPending: 0,
    skippedOld: 0,
    autoCategorized: 0,
  };

  // Fetch all transactions with pagination
  let allTransactions: TellerTransaction[] = [];
  let fromId: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const params: Record<string, string> = {
      from_date: fromDateStr,
      to_date: toDateStr,
      count: '250',
    };

    if (fromId) {
      params.from_id = fromId;
    }

    const transactions = await tellerFetch<TellerTransactionsResponse>(
      `/accounts/${connection.tellerAccountId}/transactions`,
      accessToken,
      { params }
    );

    if (transactions.length === 0) {
      hasMore = false;
    } else {
      allTransactions = allTransactions.concat(transactions);
      // Use the last transaction's ID for pagination
      fromId = transactions[transactions.length - 1].id;
      // If we got fewer than requested, we've reached the end
      if (transactions.length < 250) {
        hasMore = false;
      }
    }
  }

  // Process transactions
  for (const tellerTx of allTransactions) {
    // Skip pending transactions if not requested
    if (tellerTx.status === 'pending' && !includePending) {
      stats.skippedPending++;
      continue;
    }

    const result = await processTellerTransaction(tellerTx, connection.accountId);
    if (result === 'created') stats.added++;
    else if (result === 'skipped') stats.skippedDuplicates++;
    else if (result === 'categorized') {
      stats.added++;
      stats.autoCategorized++;
    }
  }

  // Update connection with sync status
  await prisma.tellerConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(),
      lastSyncDate: toDateStr,
      lastSyncStatus: 'success',
      lastSyncError: null,
    },
  });

  return stats;
}

async function processTellerTransaction(
  tellerTx: TellerTransaction,
  accountId: string
): Promise<'created' | 'skipped' | 'categorized'> {
  const mapped = mapTellerTransaction(tellerTx, accountId);

  // Check for existing transaction using externalId
  const existing = await prisma.transaction.findFirst({
    where: { accountId, externalId: mapped.externalId },
  });

  if (existing) return 'skipped';

  // Try to categorize using Teller's built-in category
  let categoryId: string | null = null;
  let confidence = 0.3;

  if (tellerTx.details?.category) {
    // Map Teller category to our categories
    const tellerCategory = mapTellerCategory(tellerTx.details.category);
    if (tellerCategory) {
      categoryId = await resolveCategoryId(prisma, tellerCategory);
      if (categoryId) {
        confidence = 0.85;
      }
    }
  }

  // Fall back to auto-categorization if no Teller category match
  if (!categoryId) {
    const categorization = await autoCategorize(prisma, mapped.merchant, null);
    categoryId = categorization.categoryId;
    confidence = categorization.confidence;
  }

  await prisma.transaction.create({
    data: {
      ...mapped,
      categoryId,
      confidenceScore: confidence,
    },
  });

  return categoryId ? 'categorized' : 'created';
}

function mapTellerTransaction(tellerTx: TellerTransaction, accountId: string) {
  // Teller amounts: negative = expense, positive = income
  // This matches FinanceOS convention, so no inversion needed
  const amount = parseFloat(tellerTx.amount);

  // Prefer counterparty name, fall back to description
  const merchant = tellerTx.details?.counterparty?.name || tellerTx.description || 'Unknown';

  return {
    externalId: tellerTx.id,
    date: new Date(tellerTx.date),
    amount,
    merchant,
    merchantNormalized: normalizeMerchant(merchant),
    accountId,
    isTransfer: false,
    note: tellerTx.details?.category || null,
    tags: '[]',
  };
}

// Map Teller categories to FinanceOS categories
function mapTellerCategory(tellerCategory: string): string | null {
  const categoryMap: Record<string, string> = {
    // Transportation
    'transportation': 'Transport',
    'car': 'Transport',
    'gas': 'Transport',
    'parking': 'Transport',
    'public_transit': 'Transport',
    'rideshare': 'Transport',
    'taxi': 'Transport',

    // Food
    'food_and_drink': 'Food & Dining',
    'groceries': 'Groceries',
    'restaurant': 'Food & Dining',
    'coffee': 'Coffee',
    'fast_food': 'Food & Dining',

    // Shopping
    'shopping': 'Shopping',
    'clothing': 'Shopping',
    'electronics': 'Shopping',
    'general_merchandise': 'Shopping',

    // Entertainment
    'entertainment': 'Entertainment',
    'streaming': 'Entertainment',
    'music': 'Entertainment',
    'movies': 'Entertainment',
    'games': 'Entertainment',

    // Bills & Utilities
    'utilities': 'Utilities',
    'bills': 'Bills',
    'phone': 'Phone',
    'internet': 'Internet',
    'insurance': 'Insurance',

    // Home
    'home': 'Home',
    'rent': 'Rent',
    'mortgage': 'Mortgage',
    'home_improvement': 'Home',

    // Health
    'healthcare': 'Healthcare',
    'pharmacy': 'Healthcare',
    'doctor': 'Healthcare',
    'gym': 'Health & Fitness',

    // Income
    'income': 'Income',
    'payroll': 'Income',
    'deposit': 'Income',
    'interest': 'Income',

    // Transfers
    'transfer': 'Transfer',
    'atm': 'Transfer',
    'withdrawal': 'Transfer',

    // Travel
    'travel': 'Travel',
    'lodging': 'Travel',
    'airline': 'Travel',

    // Other
    'fees': 'Fees',
    'bank_fees': 'Fees',
    'subscription': 'Subscriptions',
  };

  // Try exact match first
  const lowerCategory = tellerCategory.toLowerCase();
  if (categoryMap[lowerCategory]) {
    return categoryMap[lowerCategory];
  }

  // Try partial match
  for (const [key, value] of Object.entries(categoryMap)) {
    if (lowerCategory.includes(key) || key.includes(lowerCategory)) {
      return value;
    }
  }

  return null;
}

function formatDateForTeller(date: Date): string {
  return date.toISOString().split('T')[0];
}
