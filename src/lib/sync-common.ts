import { prisma as defaultPrisma } from '@/lib/prisma';
import { normalizeMerchant } from '@/lib/categorization';
import { v4 as uuid } from 'uuid';
import type { PrismaClient } from '@prisma/client';

/**
 * Convert a bank API amount to FinanceOS convention.
 *
 * Bank APIs (Plaid, Teller) typically use: positive = expense, negative = income
 * FinanceOS convention: negative = expense, positive = income
 *
 * By default, we invert the sign. If the account has `invertAmounts: true`,
 * we apply an additional inversion (which cancels out the default inversion).
 *
 * @param bankAmount - The raw amount from the bank API
 * @param accountInvertAmounts - The account's invertAmounts flag (default false)
 * @returns The amount in FinanceOS convention
 */
export function convertBankAmount(
  bankAmount: number,
  accountInvertAmounts: boolean = false
): number {
  // Default behavior: invert sign (bank positive = FinanceOS negative)
  let amount = -bankAmount;

  // If account has invertAmounts enabled, apply additional inversion
  // This handles accounts where the bank uses the opposite convention
  if (accountInvertAmounts) {
    amount = -amount;
  }

  return amount;
}

// Common types for sync providers (Plaid, Teller, future providers)
export type BaseSyncResult = {
  added: number;
  modified: number;
  removed: number;
  skippedDuplicates: number;
  autoCategorized: number;
  merged: number;
};

export type MergeCandidate = {
  id: string;
  merchant: string;
  merchantNormalized: string;
};

export type MappedTransaction = {
  externalId: string;
  date: Date;
  amount: number;
  merchant: string;
  merchantNormalized: string;
  accountId: string;
};

/**
 * Find a transaction that matches by date (±3 days) + amount + similar merchant but has no externalId.
 * This catches manually imported transactions that should be merged with bank data.
 * Date tolerance is needed because banks often report different dates than manual imports.
 * Also checks for inverted amounts to handle credit card sign convention differences.
 */
export async function findMergeCandidate(
  accountId: string,
  mapped: MappedTransaction
): Promise<MergeCandidate | null> {
  // Calculate date range (±3 days to handle bank date differences)
  const dateTolerance = 3;
  const fromDate = new Date(mapped.date);
  fromDate.setDate(fromDate.getDate() - dateTolerance);
  const toDate = new Date(mapped.date);
  toDate.setDate(toDate.getDate() + dateTolerance);

  // Look for transactions within date range with the same amount OR inverted amount
  // (credit cards may have opposite sign convention between manual imports and bank data)
  const candidates = await defaultPrisma.transaction.findMany({
    where: {
      accountId,
      date: {
        gte: fromDate,
        lte: toDate,
      },
      OR: [{ amount: mapped.amount }, { amount: -mapped.amount }],
      externalId: null, // Only consider transactions without an externalId (manual imports)
    },
    select: {
      id: true,
      merchant: true,
      merchantNormalized: true,
      amount: true,
    },
  });

  if (candidates.length === 0) return null;

  // Find best match by merchant similarity, preferring exact amount match
  // First pass: exact amount matches
  for (const candidate of candidates) {
    if (
      candidate.amount === mapped.amount &&
      isMerchantSimilar(candidate.merchantNormalized, mapped.merchantNormalized)
    ) {
      return candidate;
    }
  }

  // Second pass: inverted amount matches (credit card sign convention)
  for (const candidate of candidates) {
    if (
      candidate.amount === -mapped.amount &&
      isMerchantSimilar(candidate.merchantNormalized, mapped.merchantNormalized)
    ) {
      return candidate;
    }
  }

  // No merchant similarity match found - don't merge to avoid false positives
  return null;
}

/**
 * Check if two normalized merchant names are similar enough to consider the same.
 */
export function isMerchantSimilar(merchant1: string, merchant2: string): boolean {
  const norm1 = merchant1.toLowerCase().trim();
  const norm2 = merchant2.toLowerCase().trim();

  // Exact match
  if (norm1 === norm2) return true;

  // One contains the other (handles "chase" matching "chase travel")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Extract significant words (length > 2)
  const words1 = new Set(norm1.split(/\s+/).filter((w) => w.length > 2));
  const words2 = new Set(norm2.split(/\s+/).filter((w) => w.length > 2));

  // If either has no significant words, fall back to substring matching
  if (words1.size === 0 || words2.size === 0) {
    // Check if the shorter string is a prefix of any word in the longer string
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length < norm2.length ? norm2 : norm1;
    const longerWords = longer.split(/\s+/);
    return longerWords.some((w) => w.startsWith(shorter) || shorter.startsWith(w));
  }

  // Check for word overlap - if ANY significant word matches, consider similar
  // This handles "chase travel" vs "chase" where one word matches
  const intersection = [...words1].filter((w) => words2.has(w));
  if (intersection.length > 0) {
    return true;
  }

  // Check if any word from one set is contained in any word from the other
  // This handles partial matches like "walmart" in "walmart supercenter"
  for (const w1 of words1) {
    for (const w2 of words2) {
      if (w1.includes(w2) || w2.includes(w1)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determine if we should update the merchant name during merge.
 * Prefer the bank's merchant name if it looks cleaner (no quotes, better formatting).
 */
export function shouldUpdateMerchant(existingMerchant: string, newMerchant: string): boolean {
  // If existing has quotes and new doesn't, prefer new
  const existingHasQuotes = existingMerchant.includes('"') || existingMerchant.includes("'");
  const newHasQuotes = newMerchant.includes('"') || newMerchant.includes("'");

  if (existingHasQuotes && !newHasQuotes) return true;

  // If existing is all caps and new has proper case, prefer new
  const existingAllCaps = existingMerchant === existingMerchant.toUpperCase();
  const newAllCaps = newMerchant === newMerchant.toUpperCase();

  if (existingAllCaps && !newAllCaps) return true;

  // Otherwise keep existing (user may have manually edited it)
  return false;
}

/**
 * Apply merchant rename from categorization rules.
 * Returns the final merchant name and normalized version.
 */
export function applyMerchantRename(
  originalMerchant: string,
  originalNormalized: string,
  renameTo: string | null
): { merchant: string; merchantNormalized: string } {
  if (renameTo) {
    return {
      merchant: renameTo,
      merchantNormalized: normalizeMerchant(renameTo),
    };
  }
  return {
    merchant: originalMerchant,
    merchantNormalized: originalNormalized,
  };
}

// Transfer detection types
export type TransferDetectionResult = {
  transfersDetected: number;
  sameAccount: number;
  crossAccount: number;
  sameAccountTransfers: SameAccountTransfer[];
  crossAccountTransfers: CrossAccountTransfer[];
};

export type SameAccountTransfer = {
  merchant1: string;
  amount1: number;
  merchant2: string;
  amount2: number;
  date: string;
};

export type CrossAccountTransfer = {
  account1: string;
  merchant1: string;
  amount1: number;
  account2: string;
  merchant2: string;
  amount2: number;
  date: string;
};

/**
 * Detect and link transfer transactions.
 * This finds matching opposite-amount transactions and marks them as transfers
 * with a shared transferGroupId.
 *
 * @param accountId - The account being synced (for same-account detection)
 * @param newTransactionIds - Set of newly added transaction IDs to report on
 * @param prismaClient - Optional PrismaClient instance (defaults to global prisma)
 * @returns Statistics about detected transfers
 */
export async function detectTransfers(
  accountId: string,
  newTransactionIds: Set<string>,
  prismaClient: PrismaClient = defaultPrisma
): Promise<TransferDetectionResult> {
  console.log('🔄 Starting transfer detection for account:', accountId);

  // First: detect same-account transfers (e.g., internal moves)
  // Look at last 90 days to catch all recent transfers
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const recent = await prismaClient.transaction.findMany({
    where: {
      accountId,
      date: { gte: ninetyDaysAgo },
    },
    orderBy: { date: 'desc' },
  });

  console.log(`  Found ${recent.length} transactions in last 90 days for this account`);

  const byDate: Record<string, typeof recent> = {};
  recent.forEach((tx) => {
    const key = tx.date.toISOString().split('T')[0];
    byDate[key] = byDate[key] ?? [];
    byDate[key].push(tx);
  });

  let sameAccountMatches = 0;
  const sameAccountTransfers: SameAccountTransfer[] = [];

  for (const group of Object.values(byDate)) {
    for (const tx of group) {
      if (tx.isTransfer) continue;
      const match = group.find(
        (other) =>
          other.id !== tx.id &&
          other.isTransfer === false &&
          Math.abs(Number(other.amount) + Number(tx.amount)) < 0.01
      );
      if (match) {
        const transferGroupId = uuid();
        await prismaClient.transaction.updateMany({
          where: { id: { in: [tx.id, match.id] } },
          data: { isTransfer: true, transferGroupId },
        });

        // Only report if one of the transactions is newly imported
        if (newTransactionIds.has(tx.id) || newTransactionIds.has(match.id)) {
          sameAccountMatches++;
          sameAccountTransfers.push({
            merchant1: tx.merchant,
            amount1: Number(tx.amount),
            merchant2: match.merchant,
            amount2: Number(match.amount),
            date: tx.date.toISOString().split('T')[0],
          });
          console.log(
            `  ✓ Same-account transfer: ${tx.merchant} $${tx.amount} + ${match.merchant} $${match.amount}`
          );
        }
      }
    }
  }

  console.log(
    `  Found ${sameAccountMatches} same-account transfer pairs involving new transactions`
  );

  // Second: detect cross-account transfers (e.g., credit card payments)
  const { crossAccountMatches, crossAccountTransfers } = await detectCrossAccountTransfers(
    newTransactionIds,
    prismaClient
  );

  return {
    transfersDetected: sameAccountMatches + crossAccountMatches,
    sameAccount: sameAccountMatches,
    crossAccount: crossAccountMatches,
    sameAccountTransfers,
    crossAccountTransfers,
  };
}

/**
 * Detect cross-account transfers across all accounts.
 * Looks for matching opposite-amount transactions in different accounts within 3 days.
 */
export async function detectCrossAccountTransfers(
  newTransactionIds: Set<string>,
  prismaClient: PrismaClient = defaultPrisma
): Promise<{ crossAccountMatches: number; crossAccountTransfers: CrossAccountTransfer[] }> {
  console.log('🔄 Starting cross-account transfer detection');

  // Get all recent transactions across all accounts (including already-marked transfers)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const allRecent = await prismaClient.transaction.findMany({
    where: {
      date: { gte: ninetyDaysAgo },
    },
    include: { account: true },
    orderBy: { date: 'desc' },
  });

  console.log(`  Checking ${allRecent.length} transactions across all accounts (last 90 days)`);

  // Log potential transfer candidates
  const candidates = allRecent.filter((tx) => {
    const hasOpposite = allRecent.some(
      (other) =>
        other.id !== tx.id &&
        other.accountId !== tx.accountId &&
        Math.abs(Number(other.amount) + Number(tx.amount)) < 0.01
    );
    return hasOpposite;
  });

  if (candidates.length > 0) {
    console.log(`  Found ${candidates.length} transactions with matching opposite amounts:`);
    candidates.forEach((tx) => {
      console.log(
        `    - ${tx.account.name}: ${tx.merchant} $${tx.amount} on ${tx.date.toISOString().split('T')[0]} (isTransfer: ${tx.isTransfer})`
      );
    });
  }

  // Group by approximate amount (looking for matching positive/negative pairs)
  const processed = new Set<string>();
  let crossAccountMatches = 0;
  const crossAccountTransfers: CrossAccountTransfer[] = [];

  for (const tx of allRecent) {
    if (processed.has(tx.id)) continue;

    // Look for a matching transaction in a different account
    // with opposite sign, within 3 days
    const txDate = tx.date.getTime();
    const threeDays = 3 * 24 * 60 * 60 * 1000;

    const match = allRecent.find((other) => {
      if (other.id === tx.id) return false;
      if (other.accountId === tx.accountId) return false; // Must be different account
      if (processed.has(other.id)) return false;

      // Check if amounts are opposite (one positive, one negative)
      const amountsMatch = Math.abs(Number(other.amount) + Number(tx.amount)) < 0.01;
      if (!amountsMatch) return false;

      // Check if dates are within 3 days
      const otherDate = other.date.getTime();
      const dateDiff = Math.abs(txDate - otherDate);
      if (dateDiff > threeDays) return false;

      // Additional heuristic: check for transfer-like merchant names
      const transferKeywords = [
        'payment',
        'transfer',
        'xfer',
        'autopay',
        'bill pay',
        'credit card',
      ];
      const txMerchant = tx.merchant.toLowerCase();
      const otherMerchant = other.merchant.toLowerCase();
      const hasTransferKeyword = transferKeywords.some(
        (kw) => txMerchant.includes(kw) || otherMerchant.includes(kw)
      );

      // If amounts match exactly and dates are close, it's likely a transfer
      // Boost confidence if merchant names suggest transfer
      return amountsMatch && (dateDiff <= 24 * 60 * 60 * 1000 || hasTransferKeyword);
    });

    if (match) {
      const transferGroupId = uuid();
      // Mark BOTH transactions as transfers, even if one already is
      await prismaClient.transaction.updateMany({
        where: { id: { in: [tx.id, match.id] } },
        data: { isTransfer: true, transferGroupId },
      });
      processed.add(tx.id);
      processed.add(match.id);

      // Only report if one of the transactions is newly imported
      if (newTransactionIds.has(tx.id) || newTransactionIds.has(match.id)) {
        crossAccountMatches++;
        crossAccountTransfers.push({
          account1: tx.account.name,
          merchant1: tx.merchant,
          amount1: Number(tx.amount),
          account2: match.account.name,
          merchant2: match.merchant,
          amount2: Number(match.amount),
          date: tx.date.toISOString().split('T')[0],
        });
        console.log(
          `  ✓ Cross-account transfer: ${tx.account.name} $${tx.amount} ↔ ${match.account.name} $${match.amount}`
        );
      }
    }
  }

  console.log(
    `  Found ${crossAccountMatches} cross-account transfer pairs involving new transactions`
  );
  console.log('✅ Transfer detection complete');

  return { crossAccountMatches, crossAccountTransfers };
}
