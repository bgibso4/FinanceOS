import { prisma } from '@/lib/prisma';
import { tellerFetch, TellerTransaction, TellerTransactionsResponse } from '@/lib/teller';
import { decryptAccessToken } from '@/lib/encryption';
import { autoCategorize, normalizeMerchant, resolveCategoryId } from '@/lib/categorization';
import {
  findMergeCandidate as findMergeCandidateCommon,
  shouldUpdateMerchant,
  detectTransfers,
  convertBankAmount,
  retryWithBackoff,
  type MappedTransaction,
} from '@/lib/sync-common';

type TellerConnectionWithAccount = {
  id: string;
  accountId: string;
  tellerEnrollmentId: string;
  tellerAccountId: string;
  lastSyncDate: string | null;
  account: { id: string; name: string; invertAmounts: boolean };
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
  merged: number;
  transfersDetected: number;
};

// Preview transaction for dry-run mode
export type TransactionPreview = {
  externalId: string;
  date: string;
  amount: number;
  merchant: string;
  merchantNormalized: string;
  category: string | null;
  categoryConfidence: number;
  tellerCategory: string | null;
  status: 'pending' | 'posted';
  wouldCreate: boolean;
  wouldMerge: boolean;
  existingTransactionId: string | null;
  skipReason: string | null;
};

export type DryRunResult = {
  stats: SyncResult;
  transactions: TransactionPreview[];
  dateRange: {
    from: string;
    to: string;
  };
  totalFetched: number;
};

type SyncOptions = {
  daysToSync?: number;
  includePending?: boolean;
  dryRun?: boolean;
};

export async function syncTellerTransactions(
  connection: TellerConnectionWithAccount,
  options: SyncOptions = {}
): Promise<SyncResult | DryRunResult> {
  const { daysToSync = 30, includePending = false, dryRun = false } = options;

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
    merged: 0,
    transfersDetected: 0,
  };

  // Track newly created transaction IDs for transfer detection
  const newTransactionIds = new Set<string>();

  // For dry-run mode, collect previews
  const transactionPreviews: TransactionPreview[] = [];

  // Fetch all transactions with pagination
  // Note: Teller's from_id pagination may ignore date filters, so we filter client-side
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

    const transactions = await retryWithBackoff(
      (signal) =>
        tellerFetch<TellerTransactionsResponse>(
          `/accounts/${connection.tellerAccountId}/transactions`,
          accessToken,
          { params, signal }
        ),
      {
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[Teller] Retry attempt ${attempt} after ${Math.round(delayMs)}ms: ${error.message}`
          );
        },
      }
    );

    if (transactions.length === 0) {
      hasMore = false;
    } else {
      // Filter transactions to ensure they're within our date range
      // (Teller's from_id pagination may return transactions outside the date range)
      const filteredTransactions = transactions.filter((tx) => {
        const txDate = tx.date; // Format: YYYY-MM-DD
        return txDate >= fromDateStr && txDate <= toDateStr;
      });

      allTransactions = allTransactions.concat(filteredTransactions);

      // Check if we've gone past our date range - if so, stop pagination
      const lastTxDate = transactions[transactions.length - 1].date;
      if (lastTxDate < fromDateStr) {
        // Transactions are ordered newest to oldest, so if last one is before our range, stop
        hasMore = false;
      } else {
        // Use the last transaction's ID for pagination
        fromId = transactions[transactions.length - 1].id;
        // If we got fewer than requested, we've reached the end
        if (transactions.length < 250) {
          hasMore = false;
        }
      }
    }
  }

  // Get account's invertAmounts flag for amount sign handling
  const invertAmounts = connection.account.invertAmounts;

  // Process transactions
  for (const tellerTx of allTransactions) {
    // Skip pending transactions if not requested
    if (tellerTx.status === 'pending' && !includePending) {
      stats.skippedPending++;
      if (dryRun) {
        transactionPreviews.push(
          await createTransactionPreview(
            tellerTx,
            connection.accountId,
            'pending_skipped',
            null,
            invertAmounts
          )
        );
      }
      continue;
    }

    if (dryRun) {
      // Dry-run: check what would happen without writing
      const preview = await previewTellerTransaction(tellerTx, connection.accountId, invertAmounts);
      transactionPreviews.push(preview);

      if (!preview.wouldCreate && !preview.wouldMerge) {
        stats.skippedDuplicates++;
      } else if (preview.wouldMerge) {
        stats.merged++;
      } else if (preview.category) {
        stats.added++;
        stats.autoCategorized++;
      } else {
        stats.added++;
      }
    } else {
      // Real sync: actually create transactions
      const result = await processTellerTransaction(tellerTx, connection.accountId, invertAmounts);
      if (result.status === 'created') {
        stats.added++;
        if (result.transactionId) newTransactionIds.add(result.transactionId);
      } else if (result.status === 'skipped') {
        stats.skippedDuplicates++;
      } else if (result.status === 'merged') {
        stats.merged++;
      } else if (result.status === 'categorized') {
        stats.added++;
        stats.autoCategorized++;
        if (result.transactionId) newTransactionIds.add(result.transactionId);
      }
    }
  }

  // Don't update connection status in dry-run mode
  if (!dryRun) {
    await prisma.tellerConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncDate: toDateStr,
        lastSyncStatus: 'success',
        lastSyncError: null,
      },
    });
  }

  if (dryRun) {
    return {
      stats,
      transactions: transactionPreviews,
      dateRange: {
        from: fromDateStr,
        to: toDateStr,
      },
      totalFetched: allTransactions.length,
    };
  }

  // Run transfer detection on newly synced transactions
  if (newTransactionIds.size > 0) {
    const transferResult = await detectTransfers(connection.accountId, newTransactionIds);
    stats.transfersDetected = transferResult.transfersDetected;
  }

  return stats;
}

// Preview what a transaction would look like without creating it
async function previewTellerTransaction(
  tellerTx: TellerTransaction,
  accountId: string,
  invertAmounts: boolean = false
): Promise<TransactionPreview> {
  const mapped = mapTellerTransaction(tellerTx, accountId, invertAmounts);

  // Check for existing transaction using externalId (exact duplicate)
  const existingByExternalId = await prisma.transaction.findFirst({
    where: { accountId, externalId: mapped.externalId },
  });

  if (existingByExternalId) {
    return createTransactionPreview(tellerTx, accountId, 'duplicate', null);
  }

  // Check for merge candidate: same date + amount + similar merchant (but no externalId)
  const mergeCandidate = await findMergeCandidate(accountId, mapped);
  if (mergeCandidate) {
    return createTransactionPreview(tellerTx, accountId, 'merge', mergeCandidate.id);
  }

  // Try to categorize using Teller's built-in category
  let categoryName: string | null = null;
  let confidence = 0.3;

  if (tellerTx.details?.category) {
    const tellerCategory = mapTellerCategory(tellerTx.details.category);
    if (tellerCategory) {
      const categoryId = await resolveCategoryId(prisma, tellerCategory);
      if (categoryId) {
        categoryName = tellerCategory;
        confidence = 0.85;
      }
    }
  }

  // Fall back to auto-categorization if no Teller category match
  // Also check for merchant rename rules
  const categorization = await autoCategorize(prisma, mapped.merchant, null);
  if (!categoryName && categorization.categoryId) {
    // Look up category name
    const category = await prisma.category.findUnique({
      where: { id: categorization.categoryId },
    });
    categoryName = category?.name || null;
    confidence = categorization.confidence;
  }

  // Apply merchant rename if rule specifies one
  const finalMerchant = categorization.renameTo || mapped.merchant;
  const finalMerchantNormalized = categorization.renameTo
    ? normalizeMerchant(categorization.renameTo)
    : mapped.merchantNormalized;

  return {
    externalId: tellerTx.id,
    date: tellerTx.date,
    amount: mapped.amount,
    merchant: finalMerchant,
    merchantNormalized: finalMerchantNormalized,
    category: categoryName,
    categoryConfidence: confidence,
    tellerCategory: tellerTx.details?.category || null,
    status: tellerTx.status as 'pending' | 'posted',
    wouldCreate: true,
    wouldMerge: false,
    existingTransactionId: null,
    skipReason: null,
  };
}

// Helper to create preview for skipped/merged transactions
async function createTransactionPreview(
  tellerTx: TellerTransaction,
  accountId: string,
  reason: 'duplicate' | 'pending_skipped' | 'merge',
  existingTransactionId: string | null,
  invertAmounts: boolean = false
): Promise<TransactionPreview> {
  const mapped = mapTellerTransaction(tellerTx, accountId, invertAmounts);

  const skipReasonMap: Record<string, string> = {
    duplicate: 'Already exists (duplicate externalId)',
    pending_skipped: 'Pending transaction skipped',
    merge: 'Will merge with existing transaction (add externalId)',
  };

  return {
    externalId: tellerTx.id,
    date: tellerTx.date,
    amount: mapped.amount,
    merchant: mapped.merchant,
    merchantNormalized: mapped.merchantNormalized,
    category: null,
    categoryConfidence: 0,
    tellerCategory: tellerTx.details?.category || null,
    status: tellerTx.status as 'pending' | 'posted',
    wouldCreate: false,
    wouldMerge: reason === 'merge',
    existingTransactionId,
    skipReason: skipReasonMap[reason],
  };
}

// Wrapper for the common findMergeCandidate that adapts the mapped transaction type
async function findMergeCandidate(
  accountId: string,
  mapped: ReturnType<typeof mapTellerTransaction>
): Promise<{ id: string; merchant: string; merchantNormalized: string } | null> {
  const mappedForCommon: MappedTransaction = {
    externalId: mapped.externalId,
    date: mapped.date,
    amount: mapped.amount,
    merchant: mapped.merchant,
    merchantNormalized: mapped.merchantNormalized,
    accountId: mapped.accountId,
  };
  return findMergeCandidateCommon(accountId, mappedForCommon);
}

type ProcessResult = {
  status: 'created' | 'skipped' | 'merged' | 'categorized';
  transactionId?: string;
};

async function processTellerTransaction(
  tellerTx: TellerTransaction,
  accountId: string,
  invertAmounts: boolean = false
): Promise<ProcessResult> {
  const mapped = mapTellerTransaction(tellerTx, accountId, invertAmounts);

  // Check for existing transaction using externalId (exact duplicate)
  const existingByExternalId = await prisma.transaction.findFirst({
    where: { accountId, externalId: mapped.externalId },
  });

  if (existingByExternalId) return { status: 'skipped' };

  // Check for merge candidate (manual import that matches)
  const mergeCandidate = await findMergeCandidate(accountId, mapped);
  if (mergeCandidate) {
    // Merge: update the existing transaction with the externalId and optionally clean up merchant
    // Also fix the amount sign if it was inverted (credit card convention difference)
    await prisma.transaction.update({
      where: { id: mergeCandidate.id },
      data: {
        externalId: mapped.externalId,
        // Correct the amount to match bank's convention
        amount: mapped.amount,
        // Update merchant if the Teller one looks cleaner (no quotes, etc.)
        ...(shouldUpdateMerchant(mergeCandidate.merchant, mapped.merchant) && {
          merchant: mapped.merchant,
          merchantNormalized: mapped.merchantNormalized,
        }),
      },
    });
    return { status: 'merged' };
  }

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
  // Also check for merchant rename rules
  const categorization = await autoCategorize(prisma, mapped.merchant, null);
  if (!categoryId) {
    categoryId = categorization.categoryId;
    confidence = categorization.confidence;
  }

  // Apply merchant rename if rule specifies one
  const finalMerchant = categorization.renameTo || mapped.merchant;
  const finalMerchantNormalized = categorization.renameTo
    ? normalizeMerchant(categorization.renameTo)
    : mapped.merchantNormalized;

  const created = await prisma.transaction.create({
    data: {
      ...mapped,
      merchant: finalMerchant,
      merchantNormalized: finalMerchantNormalized,
      categoryId,
      confidenceScore: confidence,
    },
  });

  return {
    status: categoryId ? 'categorized' : 'created',
    transactionId: created.id,
  };
}

function mapTellerTransaction(
  tellerTx: TellerTransaction,
  accountId: string,
  invertAmounts: boolean = false
) {
  // Convert bank amount to FinanceOS convention
  // Uses shared utility that handles account-specific inversion
  const amount = convertBankAmount(parseFloat(tellerTx.amount), invertAmounts);

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
    note: null,
    tags: '[]',
  };
}

// Map Teller categories to FinanceOS categories
function mapTellerCategory(tellerCategory: string): string | null {
  const categoryMap: Record<string, string> = {
    // Transportation
    transportation: 'Transport',
    car: 'Transport',
    gas: 'Transport',
    parking: 'Transport',
    public_transit: 'Transport',
    rideshare: 'Transport',
    taxi: 'Transport',

    // Food
    food_and_drink: 'Food & Dining',
    groceries: 'Groceries',
    restaurant: 'Food & Dining',
    coffee: 'Coffee',
    fast_food: 'Food & Dining',

    // Shopping
    shopping: 'Shopping',
    clothing: 'Shopping',
    electronics: 'Shopping',
    general_merchandise: 'Shopping',

    // Entertainment
    entertainment: 'Entertainment',
    streaming: 'Entertainment',
    music: 'Entertainment',
    movies: 'Entertainment',
    games: 'Entertainment',

    // Bills & Utilities
    utilities: 'Utilities',
    bills: 'Bills',
    phone: 'Phone',
    internet: 'Internet',
    insurance: 'Insurance',

    // Home
    home: 'Home',
    rent: 'Rent',
    mortgage: 'Mortgage',
    home_improvement: 'Home',

    // Health
    healthcare: 'Healthcare',
    pharmacy: 'Healthcare',
    doctor: 'Healthcare',
    gym: 'Health & Fitness',

    // Income
    income: 'Income',
    payroll: 'Income',
    deposit: 'Income',
    interest: 'Income',

    // Transfers
    transfer: 'Transfer',
    atm: 'Transfer',
    withdrawal: 'Transfer',

    // Travel
    travel: 'Travel',
    lodging: 'Travel',
    airline: 'Travel',

    // Other
    fees: 'Fees',
    bank_fees: 'Fees',
    subscription: 'Subscriptions',
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
