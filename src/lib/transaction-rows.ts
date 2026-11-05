import type { Tx } from '@/components/transactions/types';

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
