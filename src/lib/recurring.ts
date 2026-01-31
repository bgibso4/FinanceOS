/**
 * Recurring Transaction Detection
 *
 * Strategy-pattern-based detection of recurring transactions (subscriptions, bills, memberships).
 * Groups transactions by merchant+account, sub-clusters by amount similarity,
 * and detects regular intervals using median-based analysis.
 */

import type { PrismaClient } from '@prisma/client';

// ============================================================================
// Types
// ============================================================================

export interface TransactionInput {
  id: string;
  date: Date;
  amount: number;
  merchant: string;
  merchantNormalized: string;
  accountId: string;
  categoryId: string | null;
}

export interface DetectedRecurring {
  merchantPattern: string;
  merchantDisplay: string;
  accountId: string;
  categoryId: string | null;
  frequency: string;
  expectedAmount: number;
  amountVariance: number;
  expectedDayOfMonth: number | null;
  medianIntervalDays: number;
  confidence: number;
  intervalRegularity: number;
  amountConsistency: number;
  transactionCount: number;
  firstSeenDate: Date;
  lastSeenDate: Date;
  status: 'active' | 'lapsed';
  nextExpectedDate: Date | null;
  priceHistory: Array<{ date: string; amount: number }>;
  matchingTransactionIds: string[];
}

export interface RecurringDetectionStrategy {
  name: string;
  detect(transactions: TransactionInput[]): DetectedRecurring[];
}

interface CadenceConfig {
  name: string;
  minDays: number;
  maxDays: number;
  minTransactions: number;
}

// ============================================================================
// Constants
// ============================================================================

const CADENCES: CadenceConfig[] = [
  { name: 'weekly', minDays: 5, maxDays: 9, minTransactions: 3 },
  { name: 'biweekly', minDays: 12, maxDays: 18, minTransactions: 3 },
  { name: 'monthly', minDays: 25, maxDays: 35, minTransactions: 3 },
  { name: 'quarterly', minDays: 80, maxDays: 100, minTransactions: 2 },
  { name: 'annual', minDays: 350, maxDays: 380, minTransactions: 2 },
];

// ============================================================================
// Utility Functions (exported for testing)
// ============================================================================

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

export function normalizeToMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return amount * (52 / 12);
    case 'biweekly':
      return amount * (26 / 12);
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'annual':
      return amount / 12;
    default:
      return amount;
  }
}

// ============================================================================
// Amount Sub-Clustering
// ============================================================================

/**
 * Split transactions into clusters where amounts are within ±10% of the cluster median.
 * Handles cases like Amazon Prime (monthly $14.99) vs random Amazon purchases.
 */
export function clusterByAmount(txs: TransactionInput[]): TransactionInput[][] {
  if (txs.length === 0) return [];

  const sorted = [...txs].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
  const clusters: TransactionInput[][] = [];

  for (const tx of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      const clusterMed = median(cluster.map((t) => Math.abs(t.amount)));
      if (clusterMed === 0) continue;
      if (Math.abs(Math.abs(tx.amount) - clusterMed) / clusterMed <= 0.1) {
        cluster.push(tx);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([tx]);
    }
  }

  return clusters;
}

// ============================================================================
// Billing Day Consistency
// ============================================================================

/**
 * For monthly/quarterly/annual cadences, check if transactions consistently
 * land on the same calendar day (±3 days). Returns the typical billing day
 * or null if no consistent pattern.
 */
function checkBillingDayConsistency(txs: TransactionInput[]): number | null {
  if (txs.length < 2) return null;

  const daysOfMonth = txs.map((t) => t.date.getUTCDate());
  const targetDay = median(daysOfMonth);

  const withinRange = daysOfMonth.filter((d) => {
    // Handle month boundary wrapping (e.g., day 1 vs day 30)
    const diff = Math.abs(d - targetDay);
    return Math.min(diff, 31 - diff) <= 3;
  });

  if (withinRange.length / daysOfMonth.length >= 0.8) {
    return Math.round(targetDay);
  }
  return null;
}

// ============================================================================
// Active/Lapsed Detection
// ============================================================================

function determineStatus(lastDate: Date, medianInterval: number): 'active' | 'lapsed' {
  const daysSinceLastCharge = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  const expectedGap = medianInterval * 1.5;
  return daysSinceLastCharge > expectedGap ? 'lapsed' : 'active';
}

// ============================================================================
// Next Expected Date
// ============================================================================

function computeNextExpectedDate(
  lastDate: Date,
  frequency: string,
  expectedDayOfMonth: number | null
): Date {
  const next = new Date(lastDate);
  switch (frequency) {
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'biweekly':
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (expectedDayOfMonth) {
        // Clamp to valid day for the month
        const maxDay = new Date(
          Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
        ).getUTCDate();
        next.setUTCDate(Math.min(expectedDayOfMonth, maxDay));
      }
      break;
    case 'quarterly':
      next.setUTCMonth(next.getUTCMonth() + 3);
      if (expectedDayOfMonth) {
        const maxDay = new Date(
          Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
        ).getUTCDate();
        next.setUTCDate(Math.min(expectedDayOfMonth, maxDay));
      }
      break;
    case 'annual':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

// ============================================================================
// Price History Builder
// ============================================================================

function buildPriceHistory(txs: TransactionInput[]): Array<{ date: string; amount: number }> {
  const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime());
  const history: Array<{ date: string; amount: number }> = [];
  let lastAmount: number | null = null;

  for (const tx of sorted) {
    const amount = Math.abs(tx.amount);
    if (lastAmount === null || Math.abs(amount - lastAmount) / lastAmount > 0.05) {
      history.push({
        date: tx.date.toISOString().split('T')[0],
        amount,
      });
      lastAmount = amount;
    }
  }

  return history;
}

// ============================================================================
// Best Merchant Display Name
// ============================================================================

/**
 * Pick the most common original merchant name from a cluster as the display name.
 */
function bestDisplayName(txs: TransactionInput[]): string {
  const counts = new Map<string, number>();
  for (const tx of txs) {
    const name = tx.merchant.trim();
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = txs[0].merchant;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

// ============================================================================
// Default Strategy: MedianIntervalStrategy
// ============================================================================

export class MedianIntervalStrategy implements RecurringDetectionStrategy {
  name = 'median-interval';

  detect(transactions: TransactionInput[]): DetectedRecurring[] {
    const results: DetectedRecurring[] = [];

    // Sub-cluster by amount similarity
    const clusters = clusterByAmount(transactions);

    for (const cluster of clusters) {
      const result = this.analyzeCluster(cluster);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  private analyzeCluster(txs: TransactionInput[]): DetectedRecurring | null {
    // Sort by date ascending
    const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Compute consecutive intervals in days
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const diffMs = sorted[i].date.getTime() - sorted[i - 1].date.getTime();
      intervals.push(diffMs / (1000 * 60 * 60 * 24));
    }

    if (intervals.length === 0) return null;

    // Compute median interval and match to cadence
    const medianInterval = median(intervals);
    const cadence = CADENCES.find(
      (c) => medianInterval >= c.minDays && medianInterval <= c.maxDays
    );
    if (!cadence) return null;

    // Check minimum transaction count for this cadence
    if (sorted.length < cadence.minTransactions) return null;

    // Compute interval regularity: 1 - (stddev/median)
    const intervalStd = stddev(intervals);
    const intervalRegularity = Math.max(0, Math.min(1, 1 - intervalStd / medianInterval));

    // Compute amount consistency: 1 - (stddev/median) of absolute amounts
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const amountMed = median(amounts);
    const amountStd = stddev(amounts);
    const amountConsistency =
      amountMed > 0 ? Math.max(0, Math.min(1, 1 - amountStd / amountMed)) : 0;

    // Two-signal confirmation: both must pass
    if (intervalRegularity < 0.7 || amountConsistency < 0.8) return null;

    // Combined confidence score
    const confidence = intervalRegularity * 0.6 + amountConsistency * 0.4;

    // Billing day consistency for monthly+ cadences
    const isMonthlyOrLonger = ['monthly', 'quarterly', 'annual'].includes(cadence.name);
    const expectedDayOfMonth = isMonthlyOrLonger ? checkBillingDayConsistency(sorted) : null;

    // Status detection
    const lastTx = sorted[sorted.length - 1];
    const firstTx = sorted[0];
    const status = determineStatus(lastTx.date, medianInterval);

    // Next expected date (only for active subscriptions)
    const nextExpectedDate =
      status === 'active'
        ? computeNextExpectedDate(lastTx.date, cadence.name, expectedDayOfMonth)
        : null;

    // Most common category from the cluster
    const categoryCounts = new Map<string, number>();
    for (const tx of sorted) {
      if (tx.categoryId) {
        categoryCounts.set(tx.categoryId, (categoryCounts.get(tx.categoryId) || 0) + 1);
      }
    }
    let categoryId: string | null = null;
    let maxCatCount = 0;
    for (const [catId, count] of categoryCounts) {
      if (count > maxCatCount) {
        categoryId = catId;
        maxCatCount = count;
      }
    }

    return {
      merchantPattern: sorted[0].merchantNormalized,
      merchantDisplay: bestDisplayName(sorted),
      accountId: sorted[0].accountId,
      categoryId,
      frequency: cadence.name,
      expectedAmount: amountMed,
      amountVariance: amountStd,
      expectedDayOfMonth,
      medianIntervalDays: medianInterval,
      confidence,
      intervalRegularity,
      amountConsistency,
      transactionCount: sorted.length,
      firstSeenDate: firstTx.date,
      lastSeenDate: lastTx.date,
      status,
      nextExpectedDate,
      priceHistory: buildPriceHistory(sorted),
      matchingTransactionIds: sorted.map((t) => t.id),
    };
  }
}

// ============================================================================
// Core Detection Function
// ============================================================================

/**
 * Detect recurring transactions across all accounts (or a specific account).
 * Groups by (accountId, merchantNormalized), then delegates to the strategy.
 */
export async function detectRecurringTransactions(
  prisma: PrismaClient,
  accountId?: string,
  strategy: RecurringDetectionStrategy = new MedianIntervalStrategy()
): Promise<DetectedRecurring[]> {
  // Query all non-transfer, non-offset transactions
  const where: Record<string, unknown> = {
    isTransfer: false,
    isOffset: false,
    merchantNormalized: { not: '' },
  };
  if (accountId) where.accountId = accountId;

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      amount: true,
      merchant: true,
      merchantNormalized: true,
      accountId: true,
      categoryId: true,
    },
  });

  // Group by (accountId, merchantNormalized)
  const groups = new Map<string, TransactionInput[]>();
  for (const tx of transactions) {
    const key = `${tx.accountId}|${tx.merchantNormalized}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  // Run detection strategy on each merchant group
  const allDetected: DetectedRecurring[] = [];
  for (const group of groups.values()) {
    // Skip groups too small for any cadence
    if (group.length < 2) continue;
    const detected = strategy.detect(group);
    allDetected.push(...detected);
  }

  return allDetected;
}

// ============================================================================
// Persistence: Sync Detected Results to Database
// ============================================================================

export async function syncDetectedRecurring(
  prisma: PrismaClient,
  detected: DetectedRecurring[]
): Promise<{ created: number; updated: number; skippedManual: number }> {
  let created = 0;
  let updated = 0;
  let skippedManual = 0;

  for (const item of detected) {
    // Check if existing record exists
    const existing = await prisma.recurringTransaction.findUnique({
      where: {
        accountId_merchantPattern: {
          accountId: item.accountId,
          merchantPattern: item.merchantPattern,
        },
      },
    });

    if (existing && existing.isManualOverride) {
      skippedManual++;
      continue;
    }

    const data = {
      merchantDisplay: item.merchantDisplay,
      categoryId: item.categoryId,
      frequency: item.frequency,
      expectedAmount: item.expectedAmount,
      amountVariance: item.amountVariance,
      expectedDayOfMonth: item.expectedDayOfMonth,
      medianIntervalDays: item.medianIntervalDays,
      confidence: item.confidence,
      intervalRegularity: item.intervalRegularity,
      amountConsistency: item.amountConsistency,
      transactionCount: item.transactionCount,
      firstSeenDate: item.firstSeenDate,
      lastSeenDate: item.lastSeenDate,
      status: item.status,
      nextExpectedDate: item.nextExpectedDate,
      priceHistory: JSON.stringify(item.priceHistory),
    };

    if (existing) {
      await prisma.recurringTransaction.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      await prisma.recurringTransaction.create({
        data: {
          merchantPattern: item.merchantPattern,
          accountId: item.accountId,
          ...data,
        },
      });
      created++;
    }
  }

  return { created, updated, skippedManual };
}

// ============================================================================
// Summary for Dashboard
// ============================================================================

export async function getRecurringSummary(
  prisma: PrismaClient,
  accountId?: string
): Promise<{
  totalMonthlyEstimate: number;
  totalAnnualEstimate: number;
  activeCount: number;
  lapsedCount: number;
  items: Array<{
    id: string;
    merchantPattern: string;
    merchantDisplay: string;
    accountId: string;
    categoryId: string | null;
    frequency: string;
    expectedAmount: number;
    amountVariance: number;
    expectedDayOfMonth: number | null;
    medianIntervalDays: number;
    confidence: number;
    intervalRegularity: number;
    amountConsistency: number;
    transactionCount: number;
    firstSeenDate: Date;
    lastSeenDate: Date;
    status: string;
    nextExpectedDate: Date | null;
    isManualOverride: boolean;
    manuallyCreated: boolean;
    priceHistory: Array<{ date: string; amount: number }>;
    monthlyEquivalent: number;
    account: { id: string; name: string } | null;
    category: { id: string; name: string } | null;
  }>;
}> {
  const where: Record<string, unknown> = {
    status: { not: 'dismissed' },
  };
  if (accountId) where.accountId = accountId;

  const recurring = await prisma.recurringTransaction.findMany({
    where,
    orderBy: [{ status: 'asc' }, { expectedAmount: 'desc' }],
    include: {
      account: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  });

  let totalMonthlyEstimate = 0;
  let activeCount = 0;
  let lapsedCount = 0;

  const items = recurring.map((r) => {
    const monthlyEquivalent = normalizeToMonthly(Math.abs(r.expectedAmount), r.frequency);

    if (r.status === 'active') {
      totalMonthlyEstimate += monthlyEquivalent;
      activeCount++;
    } else if (r.status === 'lapsed') {
      lapsedCount++;
    }

    let priceHistory: Array<{ date: string; amount: number }> = [];
    try {
      priceHistory = JSON.parse(r.priceHistory);
    } catch {
      // ignore parse errors
    }

    return {
      id: r.id,
      merchantPattern: r.merchantPattern,
      merchantDisplay: r.merchantDisplay,
      accountId: r.accountId,
      categoryId: r.categoryId,
      frequency: r.frequency,
      expectedAmount: r.expectedAmount,
      amountVariance: r.amountVariance,
      expectedDayOfMonth: r.expectedDayOfMonth,
      medianIntervalDays: r.medianIntervalDays,
      confidence: r.confidence,
      intervalRegularity: r.intervalRegularity,
      amountConsistency: r.amountConsistency,
      transactionCount: r.transactionCount,
      firstSeenDate: r.firstSeenDate,
      lastSeenDate: r.lastSeenDate,
      status: r.status,
      nextExpectedDate: r.nextExpectedDate,
      isManualOverride: r.isManualOverride,
      manuallyCreated: r.manuallyCreated,
      priceHistory,
      monthlyEquivalent,
      account: r.account,
      category: r.category,
    };
  });

  return {
    totalMonthlyEstimate,
    totalAnnualEstimate: totalMonthlyEstimate * 12,
    activeCount,
    lapsedCount,
    items,
  };
}
