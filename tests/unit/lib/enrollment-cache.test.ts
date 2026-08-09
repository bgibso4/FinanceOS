import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS_CACHE_TTL_MS,
  isAccountsCacheFresh,
  parseCachedAccounts,
} from '@/lib/enrollment-cache';

describe('isAccountsCacheFresh', () => {
  it('is fresh when well within the TTL', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const cachedAt = new Date(now.getTime() - 1000);
    expect(isAccountsCacheFresh(cachedAt, now)).toBe(true);
  });

  it('is stale once past the TTL', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const cachedAt = new Date(now.getTime() - (ACCOUNTS_CACHE_TTL_MS + 1));
    expect(isAccountsCacheFresh(cachedAt, now)).toBe(false);
  });

  it('is stale exactly at the TTL boundary', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const cachedAt = new Date(now.getTime() - ACCOUNTS_CACHE_TTL_MS);
    expect(isAccountsCacheFresh(cachedAt, now)).toBe(false);
  });

  it('is stale when cachedAt is null', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(isAccountsCacheFresh(null, now)).toBe(false);
  });

  it('respects a custom ttlMs', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const cachedAt = new Date(now.getTime() - 5000);
    expect(isAccountsCacheFresh(cachedAt, now, 10000)).toBe(true);
    expect(isAccountsCacheFresh(cachedAt, now, 1000)).toBe(false);
  });
});

describe('parseCachedAccounts', () => {
  it('parses a valid JSON array', () => {
    const json = JSON.stringify([{ id: 'a' }, { id: 'b' }]);
    expect(parseCachedAccounts<{ id: string }>(json)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('returns null for null input', () => {
    expect(parseCachedAccounts(null)).toBeNull();
  });

  it('returns null for malformed JSON instead of throwing', () => {
    expect(() => parseCachedAccounts('{not valid json')).not.toThrow();
    expect(parseCachedAccounts('{not valid json')).toBeNull();
  });

  it('returns null for valid JSON that is not an array', () => {
    expect(parseCachedAccounts(JSON.stringify({ foo: 'bar' }))).toBeNull();
    expect(parseCachedAccounts(JSON.stringify('a string'))).toBeNull();
    expect(parseCachedAccounts(JSON.stringify(42))).toBeNull();
  });

  it('returns an empty array unchanged', () => {
    expect(parseCachedAccounts(JSON.stringify([]))).toEqual([]);
  });
});
