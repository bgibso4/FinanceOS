import { Transaction as PlaidTransaction } from 'plaid';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { decryptAccessToken } from '@/lib/encryption';
import { autoCategorize, normalizeMerchant } from '@/lib/categorization';

type PlaidConnectionWithAccount = {
  id: string;
  accountId: string;
  plaidItemId: string;
  plaidAccountId: string;
  accessTokenEncrypted: string;
  accessTokenIv: string;
  transactionCursor: string | null;
  account: { id: string; name: string };
};

export type SyncResult = {
  added: number;
  modified: number;
  removed: number;
  skippedDuplicates: number;
  skippedOld: number;
  autoCategorized: number;
};

export async function syncPlaidTransactions(
  connection: PlaidConnectionWithAccount,
  daysToSync: number = 30
): Promise<SyncResult> {
  const plaid = getPlaidClient();
  const accessToken = decryptAccessToken(
    connection.accessTokenEncrypted,
    connection.accessTokenIv
  );

  let cursor = connection.transactionCursor || undefined;
  let hasMore = true;

  // Calculate cutoff date for filtering
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToSync);
  cutoffDate.setHours(0, 0, 0, 0);

  const stats: SyncResult = {
    added: 0,
    modified: 0,
    removed: 0,
    skippedDuplicates: 0,
    skippedOld: 0,
    autoCategorized: 0,
  };

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

    // Process added transactions
    for (const plaidTx of added) {
      if (plaidTx.account_id !== connection.plaidAccountId) continue;

      // Filter out transactions older than cutoff date
      const txDate = new Date(plaidTx.date);
      if (txDate < cutoffDate) {
        stats.skippedOld++;
        continue;
      }

      const result = await processPlaidTransaction(plaidTx, connection.accountId, 'add');
      if (result === 'created') stats.added++;
      else if (result === 'skipped') stats.skippedDuplicates++;
      if (result === 'categorized') {
        stats.added++;
        stats.autoCategorized++;
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

      const result = await processPlaidTransaction(plaidTx, connection.accountId, 'modify');
      if (result === 'modified') stats.modified++;
    }

    // Process removed transactions
    for (const removedTx of removed) {
      const result = await removeTransaction(removedTx.transaction_id, connection.accountId);
      if (result) stats.removed++;
    }

    cursor = next_cursor;
    hasMore = has_more;
  }

  // Update connection with new cursor and sync status
  await prisma.plaidConnection.update({
    where: { id: connection.id },
    data: {
      transactionCursor: cursor,
      lastSyncAt: new Date(),
      lastSyncStatus: 'success',
      lastSyncError: null,
    },
  });

  return stats;
}

async function processPlaidTransaction(
  plaidTx: PlaidTransaction,
  accountId: string,
  operation: 'add' | 'modify'
): Promise<'created' | 'modified' | 'skipped' | 'categorized'> {
  const mapped = mapPlaidTransaction(plaidTx, accountId);

  if (operation === 'add') {
    // Check for existing transaction using externalId
    const existing = await prisma.transaction.findFirst({
      where: { accountId, externalId: mapped.externalId },
    });

    if (existing) return 'skipped';

    // Auto-categorize using existing infrastructure
    const categorization = await autoCategorize(prisma, mapped.merchant, null);

    await prisma.transaction.create({
      data: {
        ...mapped,
        categoryId: categorization.categoryId,
        confidenceScore: categorization.confidence,
      },
    });

    return categorization.categoryId ? 'categorized' : 'created';
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

    return 'modified';
  }
}

function mapPlaidTransaction(plaidTx: PlaidTransaction, accountId: string) {
  // Plaid amounts: positive = money leaving account (expense)
  // FinanceOS convention: negative = expense, positive = income
  // Invert the sign
  const amount = -plaidTx.amount;

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
    note: plaidTx.personal_finance_category?.detailed || null,
    tags: '[]',
  };
}

async function removeTransaction(
  transactionId: string,
  accountId: string
): Promise<boolean> {
  const result = await prisma.transaction.deleteMany({
    where: { accountId, externalId: transactionId },
  });
  return result.count > 0;
}
