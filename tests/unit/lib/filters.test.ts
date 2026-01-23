import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDateRange, parseFilters, applyFilters } from '@/lib/filters';

describe('filters', () => {
  describe('resolveDateRange', () => {
    // Mock current date for consistent tests
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves this-month preset', () => {
      const result = resolveDateRange('this-month');

      expect(result.startDate.toISOString()).toBe('2024-06-01T00:00:00.000Z');
      // Last day of June
      expect(result.endDate.toISOString()).toBe('2024-06-30T23:59:59.999Z');
    });

    it('resolves last-month preset', () => {
      const result = resolveDateRange('last-month');

      expect(result.startDate.toISOString()).toBe('2024-05-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2024-05-31T23:59:59.999Z');
    });

    it('resolves last-month crossing year boundary', () => {
      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));

      const result = resolveDateRange('last-month');

      expect(result.startDate.toISOString()).toBe('2023-12-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2023-12-31T23:59:59.999Z');
    });

    it('resolves last-3-months preset', () => {
      const result = resolveDateRange('last-3-months');

      expect(result.startDate.toISOString()).toBe('2024-04-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2024-06-30T23:59:59.999Z');
    });

    it('resolves ytd preset', () => {
      const result = resolveDateRange('ytd');

      expect(result.startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2024-06-30T23:59:59.999Z');
    });

    it('resolves last-12-months preset', () => {
      const result = resolveDateRange('last-12-months');

      // June 2024 - 11 months = July 2023
      expect(result.startDate.toISOString()).toBe('2023-07-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2024-06-30T23:59:59.999Z');
    });

    it('resolves custom date range', () => {
      const result = resolveDateRange('custom', '2024-01-15', '2024-03-20');

      expect(result.startDate.toISOString()).toBe('2024-01-15T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2024-03-20T23:59:59.999Z');
    });

    it('uses defaults for custom with missing dates', () => {
      const result = resolveDateRange('custom');

      // Should fall back to this month
      expect(result.startDate.toISOString()).toBe('2024-06-01T00:00:00.000Z');
      expect(result.endDate.toISOString()).toBe('2024-06-30T23:59:59.999Z');
    });
  });

  describe('parseFilters', () => {
    it('parses empty search params', () => {
      const params = new URLSearchParams();
      const result = parseFilters(params);

      expect(result.startDate).toBeUndefined();
      expect(result.endDate).toBeUndefined();
      expect(result.accounts).toBeUndefined();
      expect(result.categories).toBeUndefined();
      expect(result.merchant).toBeUndefined();
      expect(result.tags).toBeUndefined();
    });

    it('parses date filters', () => {
      const params = new URLSearchParams({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });
      const result = parseFilters(params);

      expect(result.startDate).toBe('2024-01-01');
      expect(result.endDate).toBe('2024-01-31');
    });

    it('parses single account filter', () => {
      const params = new URLSearchParams();
      params.append('account', 'acc-1');
      const result = parseFilters(params);

      expect(result.accounts).toEqual(['acc-1']);
    });

    it('parses multiple account filters', () => {
      const params = new URLSearchParams();
      params.append('account', 'acc-1');
      params.append('account', 'acc-2');
      const result = parseFilters(params);

      expect(result.accounts).toEqual(['acc-1', 'acc-2']);
    });

    it('parses category filters', () => {
      const params = new URLSearchParams();
      params.append('category', 'cat-1');
      params.append('category', 'cat-2');
      const result = parseFilters(params);

      expect(result.categories).toEqual(['cat-1', 'cat-2']);
    });

    it('parses merchant filter', () => {
      const params = new URLSearchParams({ merchant: 'amazon' });
      const result = parseFilters(params);

      expect(result.merchant).toBe('amazon');
    });

    it('parses tag filters', () => {
      const params = new URLSearchParams();
      params.append('tag', 'business');
      params.append('tag', 'travel');
      const result = parseFilters(params);

      expect(result.tags).toEqual(['business', 'travel']);
    });
  });

  describe('applyFilters', () => {
    const testRows = [
      { id: '1', accountId: 'acc-1', categoryId: 'cat-1', merchant: 'AMAZON', tags: ['shopping'] },
      { id: '2', accountId: 'acc-1', categoryId: 'cat-2', merchant: 'UBER', tags: ['transport'] },
      {
        id: '3',
        accountId: 'acc-2',
        categoryId: 'cat-1',
        merchant: 'AMAZON PRIME',
        tags: ['shopping', 'subscription'],
      },
      { id: '4', accountId: 'acc-2', categoryId: 'cat-2', merchant: 'STARBUCKS', tags: [] },
    ];

    it('returns all rows when no filters', () => {
      const result = applyFilters(testRows, {});
      expect(result).toHaveLength(4);
    });

    it('filters by account', () => {
      const result = applyFilters(testRows, { accounts: ['acc-1'] });
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.accountId === 'acc-1')).toBe(true);
    });

    it('filters by multiple accounts', () => {
      const result = applyFilters(testRows, { accounts: ['acc-1', 'acc-2'] });
      expect(result).toHaveLength(4);
    });

    it('filters by category', () => {
      const result = applyFilters(testRows, { categories: ['cat-1'] });
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.categoryId === 'cat-1')).toBe(true);
    });

    it('filters by merchant (case-insensitive partial match)', () => {
      const result = applyFilters(testRows, { merchant: 'amazon' });
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.merchant.toLowerCase().includes('amazon'))).toBe(true);
    });

    it('filters by tags (all must match)', () => {
      const result = applyFilters(testRows, { tags: ['shopping'] });
      expect(result).toHaveLength(2);

      const result2 = applyFilters(testRows, { tags: ['shopping', 'subscription'] });
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('3');
    });

    it('combines multiple filters', () => {
      const result = applyFilters(testRows, {
        accounts: ['acc-1'],
        categories: ['cat-1'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('handles rows without optional fields', () => {
      const rowsWithMissing = [
        { id: '1' },
        { id: '2', accountId: 'acc-1' },
        { id: '3', categoryId: 'cat-1' },
      ];

      // Implementation passes through rows that don't have the filtered field
      // Only rows that have accountId AND it doesn't match get filtered out
      const result = applyFilters(rowsWithMissing, { accounts: ['acc-1'] });
      // Row 1 passes (no accountId), Row 2 passes (matches acc-1), Row 3 passes (no accountId)
      expect(result).toHaveLength(3);
    });
  });
});
