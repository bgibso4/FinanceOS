import { Transaction as PlaidTransaction, RemovedTransaction } from 'plaid';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { decryptAccessToken } from '@/lib/encryption';
import { autoCategorize, normalizeMerchant } from '@/lib/categorization';
import {
  findMergeCandidate as findMergeCandidateCommon,
  shouldUpdateMerchant,
  detectTransfers,
  convertBankAmount,
  type MappedTransaction,
} from '@/lib/sync-common';

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

  // Track newly created transaction IDs for transfer detection
  const newTransactionIds = new Set<string>();

  // For dry-run mode, collect previews
  const transactionPreviews: TransactionPreview[] = [];
  let totalFetched = 0;

  // Get account's invertAmounts flag for amount sign handling
  const invertAmounts = connection.account.invertAmounts;

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
      options: {
        include_personal_finance_category: true,
      },
    });

    const { added, modified, removed, next_cursor, has_more } = response.data;
    totalFetched += added.length + modified.length + removed.length;

    // Process added transactions
    for (const plaidTx of added) {
      if (plaidTx.account_id !== connection.plaidAccountId) continue;

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
          connection.accountId,
          'add',
          invertAmounts
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
          connection.accountId,
          'add',
          invertAmounts
        );
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

    // Process modified transactions
    for (const plaidTx of modified) {
      if (plaidTx.account_id !== connection.plaidAccountId) continue;

      // Filter out transactions older than cutoff date
      const txDate = new Date(plaidTx.date);
      if (txDate < cutoffDate) {
        continue;
      }

      if (dryRun) {
        const preview = await previewPlaidTransaction(
          plaidTx,
          connection.accountId,
          'modify',
          invertAmounts
        );
        transactionPreviews.push(preview);
        if (preview.wouldCreate) {
          stats.modified++;
        }
      } else {
        const result = await processPlaidTransaction(
          plaidTx,
          connection.accountId,
          'modify',
          invertAmounts
        );
        if (result.status === 'modified') stats.modified++;
      }
    }

    // Process removed transactions
    for (const removedTx of removed) {
      if (dryRun) {
        const preview = await previewRemovedTransaction(removedTx, connection.accountId);
        transactionPreviews.push(preview);
        if (preview.wouldCreate) {
          stats.removed++;
        }
      } else {
        const result = await removeTransaction(removedTx.transaction_id, connection.accountId);
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

    // Update connection sync status
    await prisma.plaidConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
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

  // Run transfer detection on newly synced transactions
  if (newTransactionIds.size > 0) {
    const transferResult = await detectTransfers(connection.accountId, newTransactionIds);
    stats.transfersDetected = transferResult.transfersDetected;
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

    // Check for merge candidate (manual import that matches)
    const mergeCandidate = await findMergeCandidate(accountId, mapped);
    if (mergeCandidate) {
      return createMergePreview(plaidTx, action, mergeCandidate.id);
    }

    // Try to categorize and check for merchant rename
    const categorization = await autoCategorize(prisma, mapped.merchant, null);
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

    // Check for merge candidate (manual import that matches)
    const mergeCandidate = await findMergeCandidate(accountId, mapped);
    if (mergeCandidate) {
      // Merge: update the existing transaction with the externalId
      // Also fix the amount sign if it was inverted (credit card convention difference)
      await prisma.transaction.update({
        where: { id: mergeCandidate.id },
        data: {
          externalId: mapped.externalId,
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
    }

    // Auto-categorize and check for merchant rename
    const categorization = await autoCategorize(prisma, mapped.merchant, null);

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
        categoryId: categorization.categoryId,
        confidenceScore: categorization.confidence,
      },
    });

    return {
      status: categorization.categoryId ? 'categorized' : 'created',
      transactionId: created.id,
    };
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

  const isTransfer =
    plaidTx.personal_finance_category?.primary === 'TRANSFER_IN' ||
    plaidTx.personal_finance_category?.primary === 'TRANSFER_OUT';

  return {
    externalId: plaidTx.transaction_id,
    date: new Date(plaidTx.date),
    amount,
    merchant,
    merchantNormalized: normalizeMerchant(merchant),
    accountId,
    isTransfer,
    note: null,
    tags: '[]',
  };
}

async function removeTransaction(transactionId: string, accountId: string): Promise<boolean> {
  const result = await prisma.transaction.deleteMany({
    where: { accountId, externalId: transactionId },
  });
  return result.count > 0;
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
