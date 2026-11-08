import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterSearchParams, resolveDateRange, parseFilters } from '@/lib/filters';

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

  describe('filterSearchParams', () => {
    it('writes what parseFilters reads, leaving out filters not in use', () => {
      const filters = {
        startDate: '2026-11-01',
        endDate: '2026-11-07',
        accounts: ['a1', 'a2'],
        categories: ['c1'],
        tags: ['Vacation'],
        merchant: 'shell',
      };

      const sp = filterSearchParams(filters);

      expect(parseFilters(sp)).toEqual(filters);
      expect(filterSearchParams({ startDate: '2026-11-01' }).toString()).toBe(
        'startDate=2026-11-01'
      );
    });
  });
});
