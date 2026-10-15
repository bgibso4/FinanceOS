import type { Prisma, PrismaClient } from '@prisma/client';
import { LEGACY_CODES } from './codes';

/** One old value rewritten in one column: rows renamed, and old rows dropped as duplicates. */
export type RenameCount = {
  column: string;
  from: string;
  to: string;
  renamed: number;
  dropped: number;
};

type Renamer = (
  tx: Prisma.TransactionClient,
  from: string,
  to: string
) => Promise<{ renamed: number; dropped: number }>;

const counted = ({ count }: { count: number }) => ({ renamed: count, dropped: 0 });

/**
 * Closes need care: if the app ran after the code change, a refresh stored new-code closes on
 * days that still have an old-code close, and `@@unique([securityId, date, source])` would reject
 * the rename. The new close is the fresher one, so the old duplicate is dropped first.
 */
const renamePrices: Renamer = async (tx, from, to) => {
  const key = (r: { securityId: string; date: Date }) => `${r.securityId}|${r.date.getTime()}`;
  const select = { id: true, securityId: true, date: true } as const;
  const legacy = await tx.securityPrice.findMany({ where: { source: from }, select });
  if (!legacy.length) return { renamed: 0, dropped: 0 };
  const taken = new Set(
    (
      await tx.securityPrice.findMany({
        where: { source: to, securityId: { in: [...new Set(legacy.map((r) => r.securityId))] } },
        select,
      })
    ).map(key)
  );
  const clashes = legacy.filter((r) => taken.has(key(r))).map((r) => r.id);
  if (clashes.length) await tx.securityPrice.deleteMany({ where: { id: { in: clashes } } });
  const { count } = await tx.securityPrice.updateMany({
    where: { source: from },
    data: { source: to },
  });
  return { renamed: count, dropped: clashes.length };
};

/** Every column whose stored codes changed (spec §3), with its legacy table. */
const COLUMNS: { column: string; legacy: Readonly<Record<string, string>>; rename: Renamer }[] = [
  {
    column: 'Security.pricing',
    legacy: LEGACY_CODES.pricing,
    rename: async (tx, from, to) =>
      counted(await tx.security.updateMany({ where: { pricing: from }, data: { pricing: to } })),
  },
  { column: 'SecurityPrice.source', legacy: LEGACY_CODES.priceSource, rename: renamePrices },
  {
    column: 'SecurityEvent.source',
    legacy: LEGACY_CODES.priceSource,
    rename: async (tx, from, to) =>
      counted(await tx.securityEvent.updateMany({ where: { source: from }, data: { source: to } })),
  },
  {
    column: 'HoldingSnapshot.source',
    legacy: LEGACY_CODES.recordSource,
    rename: async (tx, from, to) =>
      counted(
        await tx.holdingSnapshot.updateMany({ where: { source: from }, data: { source: to } })
      ),
  },
  {
    column: 'InvestmentTransaction.source',
    legacy: LEGACY_CODES.recordSource,
    rename: async (tx, from, to) =>
      counted(
        await tx.investmentTransaction.updateMany({ where: { source: from }, data: { source: to } })
      ),
  },
  {
    column: 'AccountBalance.source',
    legacy: LEGACY_CODES.balanceRowSource,
    rename: async (tx, from, to) =>
      counted(
        await tx.accountBalance.updateMany({ where: { source: from }, data: { source: to } })
      ),
  },
];

/**
 * Rewrites stored investment codes from their old vendor values to the neutral ones, in one
 * transaction. Idempotent: a second run renames nothing.
 */
export async function renameStoredSourceCodes(prisma: PrismaClient): Promise<RenameCount[]> {
  return prisma.$transaction(
    async (tx) => {
      const counts: RenameCount[] = [];
      for (const { column, legacy, rename } of COLUMNS) {
        for (const [from, to] of Object.entries(legacy)) {
          counts.push({ column, from, to, ...(await rename(tx, from, to)) });
        }
      }
      return counts;
    },
    { timeout: 120_000 }
  );
}

let run: Promise<RenameCount[]> | null = null;

/**
 * The rename, once per process (spec §3): concurrent callers share one run, and a failed run is
 * retried by the next caller. The memo is per process, not per client: a second `PrismaClient`
 * (another database) in the same process is not renamed. `getInvestmentServices` awaits it
 * before handing out any service.
 */
export function ensureStoredCodes(prisma: PrismaClient): Promise<RenameCount[]> {
  run ??= renameStoredSourceCodes(prisma).catch((error) => {
    run = null;
    throw error;
  });
  return run;
}
