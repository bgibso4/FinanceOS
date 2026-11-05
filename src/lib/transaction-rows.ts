import type { Prisma } from '@prisma/client';

export const TX_ROW_INCLUDE = {
  category: true,
  account: true,
  linkedTransaction: true,
  offsetTransactions: true,
  parentTransaction: {
    select: {
      id: true,
      amount: true,
      merchant: true,
      splitParts: {
        select: { id: true, amount: true, categoryId: true, note: true, category: true },
      },
    },
  },
} as const;

/** Shape a Prisma transaction row (with TX_ROW_INCLUDE) for the client: parse `tags`. */
export function toTxRow<T extends { amount: unknown; tags: string | null }>(
  t: T
): Omit<T, 'tags' | 'amount'> & { amount: number; tags: string[] } {
  return { ...t, amount: Number(t.amount), tags: t.tags ? JSON.parse(t.tags) : [] };
}

/** A transaction as `toTxRow` shapes it server-side (`date` is still a `Date`; JSON turns it into the client `Tx`). */
export type TxRow = ReturnType<
  typeof toTxRow<Prisma.TransactionGetPayload<{ include: typeof TX_ROW_INCLUDE }>>
>;

/** Parse a row's `tags` JSON; null when it is present but malformed. Non-string entries are dropped. */
export function parseTagsStrict(raw: string | null | undefined): string[] | null {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return null;
  }
}

/** Like `parseTagsStrict`, but a malformed value reads as no tags. */
export function parseTags(raw: string | null | undefined): string[] {
  return parseTagsStrict(raw) ?? [];
}
