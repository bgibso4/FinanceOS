import type { Prisma } from '@prisma/client';
import type { FilterParams } from './types';

/** Pseudo category id meaning "rows with no category". */
export const UNCATEGORIZED = 'uncategorized';

/**
 * The SQL part of the shared filter rules: accounts, categories and merchant.
 * Tags live in a JSON string column, so they are checked in JS with matchesTags.
 * SQLite's LIKE ignores ASCII case, so merchant needs no `mode`.
 */
export function filterWhere(f: FilterParams): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = {};
  if (f.accounts) where.accountId = { in: f.accounts };
  if (f.categories) {
    const ids = f.categories.filter((id) => id !== UNCATEGORIZED);
    if (ids.length === f.categories.length) where.categoryId = { in: ids };
    else where.OR = [{ categoryId: null }, ...(ids.length ? [{ categoryId: { in: ids } }] : [])];
  }
  if (f.merchant) where.merchant = { contains: f.merchant };
  return where;
}

/** True when no tags are wanted, or the stored JSON array holds any wanted tag. */
export function matchesTags(stored: string | null, wanted?: string[]): boolean {
  if (!wanted?.length) return true;
  if (!stored) return false;
  try {
    const tags: unknown = JSON.parse(stored);
    return Array.isArray(tags) && wanted.some((t) => tags.includes(t));
  } catch {
    return false;
  }
}
