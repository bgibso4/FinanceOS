import { describe, it, expect } from 'vitest';
import {
  median,
  stddev,
  normalizeToMonthly,
  clusterByAmount,
  MedianIntervalStrategy,
  type TransactionInput,
} from '@/lib/recurring';

// ============================================================================
// Helpers
// ============================================================================

function makeTx(
  overrides: Partial<TransactionInput> & { date: Date; amount: number }
): TransactionInput {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    date: overrides.date,
    amount: overrides.amount,
    merchant: overrides.merchant ?? 'Test Merchant',
    merchantNormalized: overrides.merchantNormalized ?? 'test merchant',
    accountId: overrides.accountId ?? 'acct-1',
    categoryId: overrides.categoryId ?? null,
  };
}

/** Create a series of monthly transactions on approximately the same day */
function makeMonthlyTxs(
  count: number,
  opts: {
    amount?: number;
    startDate?: Date;
    dayOfMonth?: number;
    merchant?: string;
    merchantNormalized?: string;
    accountId?: string;
    categoryId?: string | null;
    jitterDays?: number;
  } = {}
): TransactionInput[] {
  const {
    amount = -14.99,
    startDate = new Date('2024-01-15'),
    dayOfMonth = 15,
    merchant = 'Netflix',
    merchantNormalized = 'netflix',
    accountId = 'acct-1',
    categoryId = null,
    jitterDays = 0,
  } = opts;

  const txs: TransactionInput[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, dayOfMonth)
    );
    // Apply optional jitter
    if (jitterDays) {
      d.setUTCDate(d.getUTCDate() + Math.round((Math.random() - 0.5) * 2 * jitterDays));
    }
    txs.push(
      makeTx({
        date: d,
        amount,
        merchant,
        merchantNormalized,
        accountId,
        categoryId,
      })
    );
  }
  return txs;
}

/** Create weekly transactions */
function makeWeeklyTxs(
  count: number,
  opts: {
    amount?: number;
    startDate?: Date;
    merchant?: string;
    merchantNormalized?: string;
  } = {}
): TransactionInput[] {
  const {
    amount = -9.99,
    startDate = new Date('2024-01-01'),
    merchant = 'Gym',
    merchantNormalized = 'gym',
  } = opts;

  return Array.from({ length: count }, (_, i) => {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return makeTx({ date: d, amount, merchant, merchantNormalized });
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

describe('recurring utility functions', () => {
  describe('median', () => {
    it('returns 0 for empty array', () => {
      expect(median([])).toBe(0);
    });

    it('returns the single value for array of 1', () => {
      expect(median([42])).toBe(42);
    });

    it('returns middle value for odd-length array', () => {
      expect(median([1, 3, 5])).toBe(3);
    });

    it('returns average of two middle values for even-length array', () => {
      expect(median([1, 3, 5, 7])).toBe(4);
    });

    it('handles unsorted input', () => {
      expect(median([5, 1, 3])).toBe(3);
    });

    it('handles negative values', () => {
      expect(median([-10, -5, -1])).toBe(-5);
    });

    it('handles duplicate values', () => {
      expect(median([5, 5, 5, 5])).toBe(5);
    });

    it('does not mutate input array', () => {
      const arr = [3, 1, 2];
      median(arr);
      expect(arr).toEqual([3, 1, 2]);
    });
  });

  describe('stddev', () => {
    it('returns 0 for empty array', () => {
      expect(stddev([])).toBe(0);
    });

    it('returns 0 for single value', () => {
      expect(stddev([10])).toBe(0);
    });

    it('returns 0 for identical values', () => {
      expect(stddev([5, 5, 5, 5])).toBe(0);
    });

    it('calculates population stddev correctly', () => {
      // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, stddev=2.0
      const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.0, 1);
    });

    it('handles two values', () => {
      // [10, 20] → mean=15, variance=25, stddev=5
      expect(stddev([10, 20])).toBe(5);
    });
  });

  describe('normalizeToMonthly', () => {
    it('converts weekly to monthly', () => {
      // $10/week * (52/12) = ~$43.33/month
      expect(normalizeToMonthly(10, 'weekly')).toBeCloseTo(43.33, 1);
    });

    it('converts biweekly to monthly', () => {
      // $100/biweekly * (26/12) = ~$216.67/month
      expect(normalizeToMonthly(100, 'biweekly')).toBeCloseTo(216.67, 1);
    });

    it('returns same amount for monthly', () => {
      expect(normalizeToMonthly(14.99, 'monthly')).toBe(14.99);
    });

    it('converts quarterly to monthly', () => {
      // $30/quarter / 3 = $10/month
      expect(normalizeToMonthly(30, 'quarterly')).toBeCloseTo(10, 1);
    });

    it('converts annual to monthly', () => {
      // $120/year / 12 = $10/month
      expect(normalizeToMonthly(120, 'annual')).toBe(10);
    });

    it('returns amount for unknown frequency', () => {
      expect(normalizeToMonthly(50, 'unknown')).toBe(50);
    });
  });
});

// ============================================================================
// Amount Sub-Clustering
// ============================================================================

describe('clusterByAmount', () => {
  it('returns empty array for no transactions', () => {
    expect(clusterByAmount([])).toEqual([]);
  });

  it('puts all transactions in one cluster when amounts are similar', () => {
    const txs = [
      makeTx({ date: new Date('2024-01-15'), amount: -14.99 }),
      makeTx({ date: new Date('2024-02-15'), amount: -14.99 }),
      makeTx({ date: new Date('2024-03-15'), amount: -15.49 }),
    ];
    const clusters = clusterByAmount(txs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('separates transactions with very different amounts', () => {
    const txs = [
      makeTx({ date: new Date('2024-01-15'), amount: -14.99, merchant: 'Amazon Prime' }),
      makeTx({ date: new Date('2024-02-15'), amount: -14.99, merchant: 'Amazon Prime' }),
      makeTx({ date: new Date('2024-01-20'), amount: -87.5, merchant: 'Amazon Purchase' }),
      makeTx({ date: new Date('2024-02-20'), amount: -123.0, merchant: 'Amazon Purchase' }),
    ];
    const clusters = clusterByAmount(txs);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    // The $14.99 ones should be in one cluster
    const smallCluster = clusters.find((c) => c.some((t) => Math.abs(t.amount) < 20));
    expect(smallCluster).toBeDefined();
    expect(smallCluster!.length).toBe(2);
  });

  it('handles single transaction', () => {
    const txs = [makeTx({ date: new Date('2024-01-15'), amount: -50 })];
    const clusters = clusterByAmount(txs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(1);
  });

  it('uses ±10% threshold for clustering', () => {
    // $100 and $109 should be in same cluster (within 10%)
    // $100 and $115 should be in different clusters (>10%)
    const txs = [
      makeTx({ date: new Date('2024-01-01'), amount: -100 }),
      makeTx({ date: new Date('2024-02-01'), amount: -109 }),
      makeTx({ date: new Date('2024-03-01'), amount: -100 }),
    ];
    const clusters = clusterByAmount(txs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('splits amounts beyond 10% threshold', () => {
    const txs = [
      makeTx({ date: new Date('2024-01-01'), amount: -10 }),
      makeTx({ date: new Date('2024-02-01'), amount: -10 }),
      makeTx({ date: new Date('2024-03-01'), amount: -50 }),
      makeTx({ date: new Date('2024-04-01'), amount: -50 }),
    ];
    const clusters = clusterByAmount(txs);
    expect(clusters).toHaveLength(2);
  });
});

// ============================================================================
// MedianIntervalStrategy
// ============================================================================

describe('MedianIntervalStrategy', () => {
  const strategy = new MedianIntervalStrategy();

  it('has the correct name', () => {
    expect(strategy.name).toBe('median-interval');
  });

  describe('monthly detection', () => {
    it('detects regular monthly subscription', () => {
      const txs = makeMonthlyTxs(6, { amount: -14.99, merchant: 'Netflix' });
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('monthly');
      expect(results[0].merchantDisplay).toBe('Netflix');
      expect(results[0].expectedAmount).toBeCloseTo(14.99, 1);
      expect(results[0].transactionCount).toBe(6);
    });

    it('detects consistent billing day', () => {
      const txs = makeMonthlyTxs(6, { dayOfMonth: 15 });
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].expectedDayOfMonth).toBe(15);
    });

    it('requires at least 3 transactions for monthly', () => {
      const txs = makeMonthlyTxs(2);
      const results = strategy.detect(txs);
      expect(results).toHaveLength(0);
    });

    it('accepts exactly 3 monthly transactions', () => {
      const txs = makeMonthlyTxs(3);
      const results = strategy.detect(txs);
      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('monthly');
    });

    it('tolerates minor billing day drift (±3 days)', () => {
      const txs = [
        makeTx({ date: new Date('2024-01-15'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-02-14'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-03-17'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-04-15'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-05-16'), amount: -14.99, merchantNormalized: 'netflix' }),
      ];
      const results = strategy.detect(txs);
      expect(results).toHaveLength(1);
      expect(results[0].expectedDayOfMonth).not.toBeNull();
    });
  });

  describe('weekly detection', () => {
    it('detects weekly subscription', () => {
      const txs = makeWeeklyTxs(6);
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('weekly');
      expect(results[0].transactionCount).toBe(6);
    });

    it('requires at least 3 transactions for weekly', () => {
      const txs = makeWeeklyTxs(2);
      const results = strategy.detect(txs);
      expect(results).toHaveLength(0);
    });

    it('does not set expectedDayOfMonth for weekly', () => {
      const txs = makeWeeklyTxs(5);
      const results = strategy.detect(txs);
      expect(results).toHaveLength(1);
      expect(results[0].expectedDayOfMonth).toBeNull();
    });
  });

  describe('biweekly detection', () => {
    it('detects biweekly subscription', () => {
      const startDate = new Date('2024-01-01');
      const txs = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(startDate);
        d.setUTCDate(d.getUTCDate() + i * 14);
        return makeTx({ date: d, amount: -25, merchantNormalized: 'gym' });
      });
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('biweekly');
    });
  });

  describe('quarterly detection', () => {
    it('detects quarterly subscription', () => {
      const txs = [
        makeTx({ date: new Date('2024-01-15'), amount: -99.99, merchantNormalized: 'service' }),
        makeTx({ date: new Date('2024-04-15'), amount: -99.99, merchantNormalized: 'service' }),
        makeTx({ date: new Date('2024-07-15'), amount: -99.99, merchantNormalized: 'service' }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('quarterly');
    });

    it('requires at least 2 transactions for quarterly', () => {
      const txs = [
        makeTx({ date: new Date('2024-01-15'), amount: -99.99, merchantNormalized: 'service' }),
        makeTx({ date: new Date('2024-04-15'), amount: -99.99, merchantNormalized: 'service' }),
      ];
      const results = strategy.detect(txs);
      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('quarterly');
    });
  });

  describe('annual detection', () => {
    it('detects annual subscription', () => {
      const txs = [
        makeTx({
          date: new Date('2023-03-01'),
          amount: -119.99,
          merchantNormalized: 'amazon prime',
        }),
        makeTx({
          date: new Date('2024-03-01'),
          amount: -119.99,
          merchantNormalized: 'amazon prime',
        }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].frequency).toBe('annual');
    });
  });

  describe('two-signal confirmation', () => {
    it('rejects irregular intervals even with consistent amounts', () => {
      // Irregular spacing: 10 days, 45 days, 20 days, 60 days — no cadence
      const txs = [
        makeTx({ date: new Date('2024-01-01'), amount: -15, merchantNormalized: 'random' }),
        makeTx({ date: new Date('2024-01-11'), amount: -15, merchantNormalized: 'random' }),
        makeTx({ date: new Date('2024-02-25'), amount: -15, merchantNormalized: 'random' }),
        makeTx({ date: new Date('2024-03-16'), amount: -15, merchantNormalized: 'random' }),
        makeTx({ date: new Date('2024-05-15'), amount: -15, merchantNormalized: 'random' }),
      ];
      const results = strategy.detect(txs);
      // Should fail either because no cadence matches or regularity is too low
      expect(results).toHaveLength(0);
    });

    it('rejects regular intervals with wildly varying amounts', () => {
      // Monthly-ish intervals but amounts vary > 20%
      const txs = [
        makeTx({ date: new Date('2024-01-15'), amount: -10, merchantNormalized: 'shop' }),
        makeTx({ date: new Date('2024-02-15'), amount: -50, merchantNormalized: 'shop' }),
        makeTx({ date: new Date('2024-03-15'), amount: -20, merchantNormalized: 'shop' }),
        makeTx({ date: new Date('2024-04-15'), amount: -80, merchantNormalized: 'shop' }),
        makeTx({ date: new Date('2024-05-15'), amount: -15, merchantNormalized: 'shop' }),
      ];
      const results = strategy.detect(txs);
      // Amount sub-clustering should split these, and each cluster likely too small
      expect(results).toHaveLength(0);
    });
  });

  describe('confidence scoring', () => {
    it('calculates confidence from interval regularity and amount consistency', () => {
      const txs = makeMonthlyTxs(6, { amount: -14.99 });
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      const r = results[0];
      // Confidence = intervalRegularity * 0.6 + amountConsistency * 0.4
      const expectedConfidence = r.intervalRegularity * 0.6 + r.amountConsistency * 0.4;
      expect(r.confidence).toBeCloseTo(expectedConfidence, 5);
    });

    it('has high confidence for perfectly regular subscriptions', () => {
      const txs = makeMonthlyTxs(6, { amount: -14.99 });
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBeGreaterThan(0.9);
      expect(results[0].intervalRegularity).toBeGreaterThan(0.7);
      expect(results[0].amountConsistency).toBeGreaterThan(0.8);
    });
  });

  describe('active/lapsed detection', () => {
    it('marks recent subscription as active', () => {
      // Build monthly transactions ending ~2 weeks ago (well within 1.5x interval)
      const now = new Date();
      const txs: TransactionInput[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
        txs.push(makeTx({ date: d, amount: -14.99, merchantNormalized: 'netflix' }));
      }
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('active');
      expect(results[0].nextExpectedDate).not.toBeNull();
    });

    it('marks old subscription as lapsed', () => {
      // Monthly txs that stopped 4 months ago (> 1.5x interval)
      const txs = [
        makeTx({ date: new Date('2023-01-15'), amount: -14.99, merchantNormalized: 'hulu' }),
        makeTx({ date: new Date('2023-02-15'), amount: -14.99, merchantNormalized: 'hulu' }),
        makeTx({ date: new Date('2023-03-15'), amount: -14.99, merchantNormalized: 'hulu' }),
        makeTx({ date: new Date('2023-04-15'), amount: -14.99, merchantNormalized: 'hulu' }),
        makeTx({ date: new Date('2023-05-15'), amount: -14.99, merchantNormalized: 'hulu' }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('lapsed');
      expect(results[0].nextExpectedDate).toBeNull();
    });
  });

  describe('price history', () => {
    it('tracks price changes within the same cluster', () => {
      // Price change from $14.99 to $15.99 (within ±10% so same cluster, but >5% for history tracking)
      const txs = [
        makeTx({ date: new Date('2024-01-15'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-02-15'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-03-15'), amount: -14.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-04-15'), amount: -15.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-05-15'), amount: -15.99, merchantNormalized: 'netflix' }),
        makeTx({ date: new Date('2024-06-15'), amount: -15.99, merchantNormalized: 'netflix' }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].priceHistory.length).toBeGreaterThanOrEqual(2);
      expect(results[0].priceHistory[0].amount).toBeCloseTo(14.99, 1);
    });

    it('does not record minor fluctuations (<5%)', () => {
      const txs = [
        makeTx({ date: new Date('2024-01-15'), amount: -14.99, merchantNormalized: 'spotify' }),
        makeTx({ date: new Date('2024-02-15'), amount: -14.99, merchantNormalized: 'spotify' }),
        makeTx({ date: new Date('2024-03-15'), amount: -14.99, merchantNormalized: 'spotify' }),
        makeTx({ date: new Date('2024-04-15'), amount: -14.99, merchantNormalized: 'spotify' }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      // All same price: should be just 1 history entry
      expect(results[0].priceHistory).toHaveLength(1);
    });
  });

  describe('amount sub-clustering integration', () => {
    it('detects subscription within mixed merchant transactions', () => {
      // Amazon Prime ($14.99/month) mixed with random Amazon purchases
      const primeTxs = makeMonthlyTxs(5, {
        amount: -14.99,
        merchant: 'Amazon Prime',
        merchantNormalized: 'amazon',
      });
      const randomTxs = [
        makeTx({
          date: new Date('2024-01-20'),
          amount: -87.5,
          merchant: 'Amazon',
          merchantNormalized: 'amazon',
        }),
        makeTx({
          date: new Date('2024-02-08'),
          amount: -123.0,
          merchant: 'Amazon',
          merchantNormalized: 'amazon',
        }),
        makeTx({
          date: new Date('2024-03-25'),
          amount: -45.3,
          merchant: 'Amazon',
          merchantNormalized: 'amazon',
        }),
      ];

      const results = strategy.detect([...primeTxs, ...randomTxs]);
      // Should detect the Prime subscription cluster
      const primeResult = results.find((r) => r.expectedAmount < 20);
      expect(primeResult).toBeDefined();
      expect(primeResult!.frequency).toBe('monthly');
    });
  });

  describe('category selection', () => {
    it('picks the most common category from the cluster', () => {
      const txs = [
        makeTx({
          date: new Date('2024-01-15'),
          amount: -14.99,
          merchantNormalized: 'netflix',
          categoryId: 'cat-entertainment',
        }),
        makeTx({
          date: new Date('2024-02-15'),
          amount: -14.99,
          merchantNormalized: 'netflix',
          categoryId: 'cat-entertainment',
        }),
        makeTx({
          date: new Date('2024-03-15'),
          amount: -14.99,
          merchantNormalized: 'netflix',
          categoryId: 'cat-other',
        }),
        makeTx({
          date: new Date('2024-04-15'),
          amount: -14.99,
          merchantNormalized: 'netflix',
          categoryId: 'cat-entertainment',
        }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].categoryId).toBe('cat-entertainment');
    });

    it('handles transactions with no category', () => {
      const txs = makeMonthlyTxs(4);
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].categoryId).toBeNull();
    });
  });

  describe('merchant display name', () => {
    it('uses most common merchant name as display', () => {
      const txs = [
        makeTx({
          date: new Date('2024-01-15'),
          amount: -14.99,
          merchant: 'NETFLIX.COM',
          merchantNormalized: 'netflix',
        }),
        makeTx({
          date: new Date('2024-02-15'),
          amount: -14.99,
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
        }),
        makeTx({
          date: new Date('2024-03-15'),
          amount: -14.99,
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
        }),
        makeTx({
          date: new Date('2024-04-15'),
          amount: -14.99,
          merchant: 'Netflix',
          merchantNormalized: 'netflix',
        }),
      ];
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].merchantDisplay).toBe('Netflix');
    });
  });

  describe('edge cases', () => {
    it('returns empty for single transaction', () => {
      const txs = [makeTx({ date: new Date('2024-01-15'), amount: -14.99 })];
      const results = strategy.detect(txs);
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty input', () => {
      expect(strategy.detect([])).toEqual([]);
    });

    it('handles transactions with zero amount gracefully', () => {
      const txs = makeMonthlyTxs(4, { amount: 0 });
      const results = strategy.detect(txs);
      // Zero amount → amountConsistency would be 0, should be rejected
      expect(results).toHaveLength(0);
    });

    it('stores matching transaction IDs', () => {
      const txs = makeMonthlyTxs(4);
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].matchingTransactionIds).toHaveLength(4);
      expect(results[0].matchingTransactionIds).toEqual(
        expect.arrayContaining(txs.map((t) => t.id))
      );
    });

    it('sets firstSeenDate and lastSeenDate correctly', () => {
      const txs = makeMonthlyTxs(4, { startDate: new Date('2024-01-15') });
      const results = strategy.detect(txs);

      expect(results).toHaveLength(1);
      expect(results[0].firstSeenDate.getUTCMonth()).toBe(0); // January
      expect(results[0].lastSeenDate.getUTCMonth()).toBe(3); // April
    });
  });
});
