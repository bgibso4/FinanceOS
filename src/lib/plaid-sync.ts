import { Transaction as PlaidTransaction, RemovedTransaction } from 'plaid';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { decryptAccessToken } from '@/lib/encryption';
import { autoCategorize, normalizeMerchant } from '@/lib/categorization';
import {
  findMergeCandidate as findMergeCandidateCommon,
  findImportHashMatch,
  createImportHash,
  shouldUpdateMerchant,
  detectTransfers,
  cleanupTransferPair,
  convertBankAmount,
  retryWithBackoff,
  isUniqueConstraintError,
  RateLimitError,
  type MappedTransaction,
  type RetryOptions,
} from '@/lib/sync-common';

/**
 * Wrap a Plaid SDK call with retry/backoff/timeout.
 * Converts Plaid's AxiosError 429 responses into RateLimitError for proper backoff.
 */
async function plaidCallWithRetry<T>(fn: () => Promise<T>, retryOpts?: RetryOptions): Promise<T> {
  return retryWithBackoff(
    async () => {
      try {
        return await fn();
      } catch (error: unknown) {
        // Plaid SDK wraps axios — extract status code from response
        const axiosError = error as {
          response?: { status?: number; headers?: Record<string, string> };
        };
        if (axiosError.response?.status === 429) {
          const retryAfter = axiosError.response.headers?.['retry-after'];
          let retryAfterMs = 5000;
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            retryAfterMs = isNaN(seconds) ? 5000 : seconds * 1000;
          }
          throw new RateLimitError('Plaid API rate limited (429)', retryAfterMs);
        }
        throw error;
      }
    },
    {
      onRetry: (attempt, error, delayMs) => {
        console.warn(
          `[Plaid] Retry attempt ${attempt} after ${Math.round(delayMs)}ms: ${error.message}`
        );
      },
      ...retryOpts,
    }
  );
}

type PlaidConnectionWithEnrollment = {
  id: string;
  accountId: string;
  plaidAccountId: string;
  account: { id: string; name: string; invertAmounts: boolean };
  plaidEnrollment: {
    id: string;
    plaidItemId: string;
    accessTokenEncrypted: string;
    accessTokenIv: string;
    transactionCursor: string | null;
  };
};

export type SyncResult = {
  added: number;
  modified: number;
  removed: number;
  skippedDuplicates: number;
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
  plaidCategory: string | null;
  isTransfer: boolean;
  action: 'add' | 'modify' | 'remove';
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
  dryRun?: boolean;
};

export async function syncPlaidTransactions(
  connection: PlaidConnectionWithEnrollment,
  options: SyncOptions = {}
): Promise<SyncResult | DryRunResult> {
  const { daysToSync = 30, dryRun = false } = options;

  const plaid = getPlaidClient();
  const { plaidEnrollment } = connection;
  const accessToken = decryptAccessToken(
    plaidEnrollment.accessTokenEncrypted,
    plaidEnrollment.accessTokenIv
  );

  // Build routing map for ALL connections under this enrollment.
  // Plaid returns transactions for all accounts in an item, but the cursor is shared.
  // We must process transactions for all sibling accounts to avoid silently dropping them.
  const siblingConnections = await prisma.plaidConnection.findMany({
    where: {
      plaidEnrollmentId: plaidEnrollment.id,
      status: 'connected',
    },
    include: { account: true },
  });

  const accountMap = new Map<
    string,
    { accountId: string; invertAmounts: boolean; connectionId: string }
  >();
  for (const sibling of siblingConnections) {
    accountMap.set(sibling.plaidAccountId, {
      accountId: sibling.accountId,
      invertAmounts: sibling.account.invertAmounts,
      connectionId: sibling.id,
    });
  }

  let cursor = plaidEnrollment.transactionCursor || undefined;
  let hasMore = true;

  // Calculate cutoff date for filtering
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToSync);
  cutoffDate.setHours(0, 0, 0, 0);

  const toDate = new Date();

  const stats: SyncResult = {
    added: 0,
    modified: 0,
    removed: 0,
    skippedDuplicates: 0,
    skippedOld: 0,
    autoCategorized: 0,
    merged: 0,
    transfersDetected: 0,
  };

  // Track newly created transaction IDs per account for transfer detection
  const newTransactionIdsByAccount = new Map<string, Set<string>>();

  // For dry-run mode, collect previews
  const transactionPreviews: TransactionPreview[] = [];
  let totalFetched = 0;

  while (hasMore) {
    const response = await plaidCallWithRetry(() =>
      plaid.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
        options: {
          include_personal_finance_category: true,
        },
      })
    );

    const { added, modified, removed, next_cursor, has_more } = response.data;
    totalFetched += added.length + modified.length + removed.length;

    // Process added transactions
    for (const plaidTx of added) {
      const target = accountMap.get(plaidTx.account_id);
      if (!target) continue; // Transaction for an unlinked Plaid account

      // Filter out transactions older than cutoff date
      const txDate = new Date(plaidTx.date);
      if (txDate < cutoffDate) {
        stats.skippedOld++;
        if (dryRun) {
          transactionPreviews.push(
            createSkippedPreview(plaidTx, 'add', 'Transaction older than sync window')
          );
        }
        continue;
      }

      if (dryRun) {
        const preview = await previewPlaidTransaction(
          plaidTx,
          target.accountId,
          'add',
          target.invertAmounts
        );
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
        const result = await processPlaidTransaction(
          plaidTx,
          target.accountId,
          'add',
          target.invertAmounts
        );
        if (result.status === 'created' || result.status === 'categorized') {
          stats.added++;
          if (result.status === 'categorized') stats.autoCategorized++;
          if (result.transactionId) {
            let ids = newTransactionIdsByAccount.get(target.accountId);
            if (!ids) {
              ids = new Set<string>();
              newTransactionIdsByAccount.set(target.accountId, ids);
            }
            ids.add(result.transactionId);
          }
        } else if (result.status === 'skipped') {
          stats.skippedDuplicates++;
        } else if (result.status === 'merged') {
          stats.merged++;
        }
      }
    }

    // Process modified transactions
    for (const plaidTx of modified) {
      const target = accountMap.get(plaidTx.account_id);
      if (!target) continue;

      // Filter out transactions older than cutoff date
      const txDate = new Date(plaidTx.date);
      if (txDate < cutoffDate) {
        continue;
      }

      if (dryRun) {
        const preview = await previewPlaidTransaction(
          plaidTx,
          target.accountId,
          'modify',
          target.invertAmounts
        );
        transactionPreviews.push(preview);
        if (preview.wouldCreate) {
          stats.modified++;
        }
      } else {
        const result = await processPlaidTransaction(
          plaidTx,
          target.accountId,
          'modify',
          target.invertAmounts
        );
        if (result.status === 'modified') stats.modified++;
      }
    }

    // Process removed transactions — route by looking up which account owns the externalId
    for (const removedTx of removed) {
      // Plaid RemovedTransaction has account_id — use it to route to the correct account
      const target = removedTx.account_id ? accountMap.get(removedTx.account_id) : null;
      const targetAccountId = target?.accountId ?? connection.accountId;

      if (dryRun) {
        const preview = await previewRemovedTransaction(removedTx, targetAccountId);
        transactionPreviews.push(preview);
        if (preview.wouldCreate) {
          stats.removed++;
        }
      } else {
        const result = await removeTransaction(removedTx.transaction_id, targetAccountId);
        if (result) stats.removed++;
      }
    }

    cursor = next_cursor;
    hasMore = has_more;
  }

  // Don't update connection/enrollment status in dry-run mode
  if (!dryRun) {
    // Update enrollment cursor (shared across all connections)
    await prisma.plaidEnrollment.update({
      where: { id: plaidEnrollment.id },
      data: {
        transactionCursor: cursor,
        lastSyncAt: new Date(),
      },
    });

    // Update sync status for all sibling connections that were processed
    const now = new Date();
    await prisma.plaidConnection.updateMany({
      where: {
        id: { in: siblingConnections.map((s) => s.id) },
      },
      data: {
        lastSyncAt: now,
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
        from: cutoffDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      totalFetched,
    };
  }

  // Run transfer detection for each account that had new transactions
  for (const [accountId, newIds] of newTransactionIdsByAccount) {
    if (newIds.size > 0) {
      const transferResult = await detectTransfers(accountId, newIds);
      stats.transfersDetected += transferResult.transfersDetected;
    }
  }

  return stats;
}

// Preview what a transaction would look like without creating it
async function previewPlaidTransaction(
  plaidTx: PlaidTransaction,
  accountId: string,
  action: 'add' | 'modify',
  invertAmounts: boolean = false
): Promise<TransactionPreview> {
  const mapped = mapPlaidTransaction(plaidTx, accountId, invertAmounts);

  if (action === 'add') {
    // Check for existing transaction using externalId (exact duplicate)
    const existing = await prisma.transaction.findFirst({
      where: { accountId, externalId: mapped.externalId },
    });

    if (existing) {
      return createSkippedPreview(plaidTx, action, 'Already exists (duplicate externalId)');
    }

    // Check importHash: catches re-enrollment duplicates
    const hashMatch = await findImportHashMatch(accountId, mapped.importHash, mapped.externalId);
    if (hashMatch) {
      return createMergePreview(plaidTx, action, hashMatch.id);
    }

    // Check for merge candidate (manual import that matches)
    const mergeCandidate = await findMergeCandidate(accountId, mapped);
    if (mergeCandidate) {
      return createMergePreview(plaidTx, action, mergeCandidate.id);
    }

    // Try to categorize and check for merchant rename
    const categorization = await autoCategorize(
      prisma,
      mapped.merchant,
      null,
      mapped.amount,
      accountId
    );
    let categoryName: string | null = null;

    if (categorization.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categorization.categoryId },
      });
      categoryName = category?.name || null;
    }

    // Apply merchant rename if rule specifies one
    const finalMerchant = categorization.renameTo || mapped.merchant;
    const finalMerchantNormalized = categorization.renameTo
      ? normalizeMerchant(categorization.renameTo)
      : mapped.merchantNormalized;

    return {
      externalId: plaidTx.transaction_id,
      date: plaidTx.date,
      amount: mapped.amount,
      merchant: finalMerchant,
      merchantNormalized: finalMerchantNormalized,
      category: categoryName,
      categoryConfidence: categorization.confidence,
      plaidCategory: plaidTx.personal_finance_category?.detailed || null,
      isTransfer: mapped.isTransfer,
      action,
      wouldCreate: true,
      wouldMerge: false,
      existingTransactionId: null,
      skipReason: null,
    };
  } else {
    // For modify, check if transaction exists
    const existing = await prisma.transaction.findFirst({
      where: { accountId, externalId: mapped.externalId },
    });

    return {
      externalId: plaidTx.transaction_id,
      date: plaidTx.date,
      amount: mapped.amount,
      merchant: mapped.merchant,
      merchantNormalized: mapped.merchantNormalized,
      category: null,
      categoryConfidence: 0,
      plaidCategory: plaidTx.personal_finance_category?.detailed || null,
      isTransfer: mapped.isTransfer,
      action,
      wouldCreate: !!existing,
      wouldMerge: false,
      existingTransactionId: null,
      skipReason: existing ? null : 'Transaction not found for modification',
    };
  }
}

// Preview a removed transaction
async function previewRemovedTransaction(
  removedTx: RemovedTransaction,
  accountId: string
): Promise<TransactionPreview> {
  const existing = await prisma.transaction.findFirst({
    where: { accountId, externalId: removedTx.transaction_id },
  });

  return {
    externalId: removedTx.transaction_id,
    date: '',
    amount: existing?.amount || 0,
    merchant: existing?.merchant || 'Unknown',
    merchantNormalized: existing?.merchantNormalized || '',
    category: null,
    categoryConfidence: 0,
    plaidCategory: null,
    isTransfer: false,
    action: 'remove',
    wouldCreate: !!existing,
    wouldMerge: false,
    existingTransactionId: null,
    skipReason: existing ? null : 'Transaction not found for removal',
  };
}

// Helper to create preview for merge candidates
function createMergePreview(
  plaidTx: PlaidTransaction,
  action: 'add' | 'modify',
  existingTransactionId: string
): TransactionPreview {
  const merchant = plaidTx.merchant_name || plaidTx.name || 'Unknown';
  const amount = -plaidTx.amount;
  const isTransfer =
    plaidTx.personal_finance_category?.primary === 'TRANSFER_IN' ||
    plaidTx.personal_finance_category?.primary === 'TRANSFER_OUT';

  return {
    externalId: plaidTx.transaction_id,
    date: plaidTx.date,
    amount,
    merchant,
    merchantNormalized: normalizeMerchant(merchant),
    category: null,
    categoryConfidence: 0,
    plaidCategory: plaidTx.personal_finance_category?.detailed || null,
    isTransfer,
    action,
    wouldCreate: false,
    wouldMerge: true,
    existingTransactionId,
    skipReason: 'Will merge with existing transaction (add externalId)',
  };
}

// Helper to create preview for skipped transactions
function createSkippedPreview(
  plaidTx: PlaidTransaction,
  action: 'add' | 'modify',
  skipReason: string
): TransactionPreview {
  const merchant = plaidTx.merchant_name || plaidTx.name || 'Unknown';
  const amount = -plaidTx.amount;
  const isTransfer =
    plaidTx.personal_finance_category?.primary === 'TRANSFER_IN' ||
    plaidTx.personal_finance_category?.primary === 'TRANSFER_OUT';

  return {
    externalId: plaidTx.transaction_id,
    date: plaidTx.date,
    amount,
    merchant,
    merchantNormalized: normalizeMerchant(merchant),
    category: null,
    categoryConfidence: 0,
    plaidCategory: plaidTx.personal_finance_category?.detailed || null,
    isTransfer,
    action,
    wouldCreate: false,
    wouldMerge: false,
    existingTransactionId: null,
    skipReason,
  };
}

type ProcessResult = {
  status: 'created' | 'modified' | 'skipped' | 'categorized' | 'merged';
  transactionId?: string;
};

async function processPlaidTransaction(
  plaidTx: PlaidTransaction,
  accountId: string,
  operation: 'add' | 'modify',
  invertAmounts: boolean = false
): Promise<ProcessResult> {
  const mapped = mapPlaidTransaction(plaidTx, accountId, invertAmounts);

  if (operation === 'add') {
    // Check for existing transaction using externalId (exact duplicate)
    const existing = await prisma.transaction.findFirst({
      where: { accountId, externalId: mapped.externalId },
    });

    if (existing) return { status: 'skipped' };

    // Check importHash: catches re-enrollment duplicates where Plaid minted new
    // transaction IDs for the same underlying bank transactions.
    const hashMatch = await findImportHashMatch(accountId, mapped.importHash, mapped.externalId);
    if (hashMatch) {
      try {
        await prisma.transaction.update({
          where: { id: hashMatch.id },
          data: { externalId: mapped.externalId },
        });
        return { status: 'merged' };
      } catch (err) {
        // A concurrent sync already claimed this externalId between our check and
        // this update — it's handled, so skip rather than crash.
        if (isUniqueConstraintError(err)) return { status: 'skipped' };
        throw err;
      }
    }

    // Check for merge candidate (manual import that matches)
    const mergeCandidate = await findMergeCandidate(accountId, mapped);
    if (mergeCandidate) {
      // Merge: update the existing transaction with the externalId
      // Also fix the amount sign if it was inverted (credit card convention difference)
      try {
        await prisma.transaction.update({
          where: { id: mergeCandidate.id },
          data: {
            externalId: mapped.externalId,
            importHash: mapped.importHash,
            // Correct the amount to match bank's convention
            amount: mapped.amount,
            // Update merchant if the Plaid one looks cleaner
            ...(shouldUpdateMerchant(mergeCandidate.merchant, mapped.merchant) && {
              merchant: mapped.merchant,
              merchantNormalized: mapped.merchantNormalized,
            }),
          },
        });
        return { status: 'merged' };
      } catch (err) {
        if (isUniqueConstraintError(err)) return { status: 'skipped' };
        throw err;
      }
    }

    // Auto-categorize and check for merchant rename
    const categorization = await autoCategorize(
      prisma,
      mapped.merchant,
      null,
      mapped.amount,
      accountId
    );

    // Apply merchant rename if rule specifies one
    const finalMerchant = categorization.renameTo || mapped.merchant;
    const finalMerchantNormalized = categorization.renameTo
      ? normalizeMerchant(categorization.renameTo)
      : mapped.merchantNormalized;

    try {
      const created = await prisma.transaction.create({
        data: {
          ...mapped,
          merchant: finalMerchant,
          merchantNormalized: finalMerchantNormalized,
          categoryId: categorization.categoryId,
          confidenceScore: categorization.confidence,
        },
      });

      return {
        status: categorization.categoryId ? 'categorized' : 'created',
        transactionId: created.id,
      };
    } catch (err) {
      // A concurrent sync inserted this externalId between our dedup checks and
      // this create — treat as an already-handled duplicate instead of crashing.
      if (isUniqueConstraintError(err)) return { status: 'skipped' };
      throw err;
    }
  } else {
    // Modify existing transaction
    await prisma.transaction.updateMany({
      where: { accountId, externalId: mapped.externalId },
      data: {
        amount: mapped.amount,
        merchant: mapped.merchant,
        merchantNormalized: mapped.merchantNormalized,
        date: mapped.date,
      },
    });

    return { status: 'modified' };
  }
}

function mapPlaidTransaction(
  plaidTx: PlaidTransaction,
  accountId: string,
  invertAmounts: boolean = false
) {
  // Convert bank amount to FinanceOS convention
  // Uses shared utility that handles account-specific inversion
  const amount = convertBankAmount(plaidTx.amount, invertAmounts);

  const merchant = plaidTx.merchant_name || plaidTx.name || 'Unknown';
  const merchantNormalized = normalizeMerchant(merchant);
  const date = new Date(plaidTx.date);

  const isTransfer =
    plaidTx.personal_finance_category?.primary === 'TRANSFER_IN' ||
    plaidTx.personal_finance_category?.primary === 'TRANSFER_OUT';

  return {
    externalId: plaidTx.transaction_id,
    date,
    amount,
    merchant,
    merchantNormalized,
    accountId,
    isTransfer,
    note: null,
    tags: '[]',
    importHash: createImportHash(accountId, date, amount, merchantNormalized),
  };
}

async function removeTransaction(transactionId: string, accountId: string): Promise<boolean> {
  // Find the transaction first so we can clean up its transfer pair
  const tx = await prisma.transaction.findFirst({
    where: { accountId, externalId: transactionId },
    select: { id: true },
  });

  if (!tx) return false;

  await cleanupTransferPair(tx.id);
  await prisma.transaction.delete({ where: { id: tx.id } });
  return true;
}

// Wrapper for the common findMergeCandidate that adapts the mapped transaction type
async function findMergeCandidate(
  accountId: string,
  mapped: ReturnType<typeof mapPlaidTransaction>
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
