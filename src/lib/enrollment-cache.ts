// Pure helpers for caching a provider's raw account list on an enrollment row.
// No I/O here — callers own reading/writing the `cachedAccounts` /
// `accountsCachedAt` columns; this module only decides "is it fresh" and
// "does it parse".

// A bank's account list only changes when the user opens or closes an
// account at that institution. Both of those paths refresh the cache
// explicitly (the enrollment creation/update routes write a fresh cache as
// soon as they see the provider's account list), so this TTL is just a
// backstop for a cache that never got explicitly invalidated — not the
// primary invalidation mechanism.
export const ACCOUNTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Whether a cached-accounts timestamp is still within the TTL. `cachedAt` is
 * null when nothing has ever been cached, which is always stale.
 */
export function isAccountsCacheFresh(
  cachedAt: Date | null,
  now: Date,
  ttlMs: number = ACCOUNTS_CACHE_TTL_MS
): boolean {
  if (cachedAt === null) return false;
  return now.getTime() - cachedAt.getTime() < ttlMs;
}

/**
 * Parse a cached accounts JSON blob. Returns null for a null input, invalid
 * JSON, or JSON that doesn't parse to an array — never throws. A corrupt or
 * unexpected cache must fall back to a live provider fetch, not a 500.
 */
export function parseCachedAccounts<T>(json: string | null): T[] | null {
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  return Array.isArray(parsed) ? (parsed as T[]) : null;
}
