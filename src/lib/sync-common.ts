import crypto from 'crypto';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { normalizeMerchant } from '@/lib/categorization';
import { v4 as uuid } from 'uuid';
import type { PrismaClient } from '@prisma/client';

/**
 * SHA256 hash of (accountId, dateOnly, amount, merchantNormalized). Stable across
 * provider re-enrollments (Teller/Plaid mint new externalIds, but importHash stays).
 * Used as a 3rd-tier dedup check after externalId and merge-candidate matches.
 */
export function createImportHash(
  accountId: string,
  date: Date,
  amount: number,
  merchantNormalized: string
): string {
  const dateStr = date.toISOString().split('T')[0];
  return crypto
    .createHash('sha256')
    .update(`${accountId}|${dateStr}|${amount}|${merchantNormalized}`)
    .digest('hex');
}

// ─── Retry with Exponential Backoff ─────────────────────────────────────────

export class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export type RetryOptions = {
  /** Max number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Max backoff delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Timeout per attempt in ms (default: 30000) */
  timeoutMs?: number;
  /** Called before each retry with attempt info */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Determine if an error is retryable (default: transient errors only) */
  isRetryable?: (error: Error) => boolean;
};

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutMs: 30000,
};

/**
 * Default check for whether an error is retryable.
 * Retries on: rate limits, timeouts, network errors, 5xx server errors.
 * Does NOT retry on: auth errors (401/403), not found (404), validation (400).
 */
function defaultIsRetryable(error: Error): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof TimeoutError) return true;

  const msg = error.message.toLowerCase();

  // Network-level failures
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('etimedout') || msg.includes('esockettimedout')) return true;
  if (msg.includes('enotfound')) return true;
  if (msg.includes('network') || msg.includes('socket hang up')) return true;

  // Server errors (5xx)
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504'))
    return true;
  if (msg.includes('internal server error') || msg.includes('bad gateway')) return true;
  if (msg.includes('service unavailable') || msg.includes('gateway timeout')) return true;

  return false;
}

/**
 * Execute a function with retry logic, exponential backoff, and timeout.
 * Handles 429 rate-limit responses by respecting Retry-After headers.
 */
export async function retryWithBackoff<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_RETRY_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
    timeoutMs = DEFAULT_RETRY_OPTIONS.timeoutMs,
  } = options;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const onRetry = options.onRetry;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (error: unknown) {
      clearTimeout(timer);

      const err =
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : 'Unknown error');

      // Convert AbortError to TimeoutError
      if (err.name === 'AbortError' || controller.signal.aborted) {
        lastError = new TimeoutError(`Request timed out after ${timeoutMs}ms`);
      } else {
        lastError = err;
      }

      // Don't retry if we've exhausted attempts or the error isn't retryable
      if (attempt >= maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      // Calculate delay: use Retry-After for rate limits, exponential backoff otherwise
      let delayMs: number;
      if (lastError instanceof RateLimitError) {
        delayMs = lastError.retryAfterMs;
      } else {
        // Exponential backoff with jitter: base * 2^attempt + random jitter
        const exponentialDelay = initialDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * initialDelayMs * 0.5;
        delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);
      }

      onRetry?.(attempt + 1, lastError, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Retry failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Find an existing transaction with the same importHash but a stale (or missing)
 * externalId. Catches duplicates introduced when a Teller/Plaid enrollment is
 * re-linked: the underlying bank transaction is the same, but the new external IDs
 * don't match anything, so externalId-based dedup misses them. Returns the existing
 * row so the caller can update its externalId in place instead of creating a new row.
 */
export async function findImportHashMatch(
  accountId: string,
  importHash: string,
  newExternalId: string
): Promise<{
  id: string;
  externalId: string | null;
  categoryId: string | null;
  confidenceScore: number;
} | null> {
  const match = await defaultPrisma.transaction.findFirst({
    where: {
      accountId,
      importHash,
      // Skip rows that already have THIS externalId (would be exact dup, caught earlier);
      // include rows with null or a different externalId (stale from prior enrollment).
      NOT: { externalId: newExternalId },
    },
    select: { id: true, externalId: true, categoryId: true, confidenceScore: true },
  });
  return match;
}

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

/**
 * Clean up the transfer pair when a transaction is about to be deleted.
 * Resets isTransfer and transferGroupId on the paired transaction.
 */
export async function cleanupTransferPair(
  transactionId: string,
  prismaClient: PrismaClient = defaultPrisma
): Promise<void> {
  const tx = await prismaClient.transaction.findUnique({
    where: { id: transactionId },
    select: { transferGroupId: true },
  });

  if (!tx?.transferGroupId) return;

  // Reset the paired transaction(s) in this transfer group
  await prismaClient.transaction.updateMany({
    where: {
      transferGroupId: tx.transferGroupId,
      id: { not: transactionId },
    },
    data: {
      isTransfer: false,
      transferGroupId: null,
    },
  });
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
