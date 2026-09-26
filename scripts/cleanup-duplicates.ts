/**
 * Cleanup duplicate transactions created by Teller enrollment re-link.
 *
 * Background: When a Teller enrollment dies and is replaced (disconnect + reconnect),
 * Teller mints new transaction IDs, so externalId-based dedup fails and the same
 * underlying bank transactions get inserted again. This script collapses each
 * (accountId, date, amount) duplicate group into a single row, preserving the
 * best categorization/notes/tags and standing on the newest externalId so future
 * syncs match.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicates.ts                          # dry-run, all accounts
 *   npx tsx scripts/cleanup-duplicates.ts --institution=Chase      # filter by institution
 *   npx tsx scripts/cleanup-duplicates.ts --account=<id>           # filter by account id
 *   npx tsx scripts/cleanup-duplicates.ts --institution=Chase --commit
 *   npx tsx scripts/cleanup-duplicates.ts --institution=Chase --cross-provider
 *     ^ also pairs Teller rows against Plaid rows within +/-3 days (--window-days=N),
 *       for institutions migrated from one provider to the other.
 */

import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { isMerchantSimilar } from '../src/lib/sync-common';

type Args = {
  institution?: string;
  accountId?: string;
  commit: boolean;
  crossProvider: boolean;
  windowDays: number;
};

function parseArgs(): Args {
  const args: Args = { commit: false, crossProvider: false, windowDays: 3 };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--commit') args.commit = true;
    else if (arg === '--cross-provider') args.crossProvider = true;
    else if (arg.startsWith('--window-days='))
      args.windowDays = Number(arg.slice('--window-days='.length));
    else if (arg.startsWith('--institution='))
      args.institution = arg.slice('--institution='.length);
    else if (arg.startsWith('--account=')) args.accountId = arg.slice('--account='.length);
    else if (arg === '--help' || arg === '-h') {
      console.warn('Usage: see header comment');
      process.exit(0);
    }
  }
  return args;
}

function createImportHash(
  accountId: string,
  date: Date,
  amount: number,
  merchantNormalized: string
): string {
  const dateStr = date.toISOString().split('T')[0];
  const data = `${accountId}|${dateStr}|${amount}|${merchantNormalized}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

type TxRow = {
  id: string;
  date: Date;
  amount: number;
  accountId: string;
  merchant: string;
  merchantNormalized: string;
  categoryId: string | null;
  confidenceScore: number;
  note: string | null;
  tags: string | null;
  externalId: string | null;
  importHash: string | null;
  isTransfer: boolean;
  transferGroupId: string | null;
  linkedTransactionId: string | null;
  isOffset: boolean;
  isSplitParent: boolean;
  parentTransactionId: string | null;
  createdAt: Date;
};

type GroupStats = {
  totalGroups: number;
  groupsCollapsed: number;
  groupsSkipped: number;
  rowsDeleted: number;
};

async function processAccount(
  accountId: string,
  accountName: string,
  commit: boolean
): Promise<GroupStats> {
  const stats: GroupStats = {
    totalGroups: 0,
    groupsCollapsed: 0,
    groupsSkipped: 0,
    rowsDeleted: 0,
  };

  // Find (date, amount) groups with 2+ rows
  const dupeGroups = await prisma.$queryRawUnsafe<
    Array<{ date: Date; amount: number; cnt: bigint }>
  >(
    'SELECT date, amount, COUNT(*) as cnt FROM "Transaction" WHERE accountId = ? GROUP BY date, amount HAVING cnt > 1 ORDER BY date DESC',
    accountId
  );

  stats.totalGroups = dupeGroups.length;
  if (dupeGroups.length === 0) {
    console.warn(`  [${accountName}] no duplicate groups found`);
    return stats;
  }

  console.warn(`  [${accountName}] ${dupeGroups.length} duplicate group(s)`);

  for (const group of dupeGroups) {
    const rows = (await prisma.transaction.findMany({
      where: { accountId, date: group.date, amount: group.amount },
      orderBy: { createdAt: 'desc' },
    })) as TxRow[];

    if (rows.length < 2) continue;

    const dateStr = group.date.toISOString().slice(0, 10);
    const label = `${dateStr} amt=${group.amount}`;
    await collapseGroup(accountId, rows, label, commit, stats);
  }

  return stats;
}

/**
 * Collapse one set of rows known to describe the same real transaction into a single
 * row, folding the others' categorisation, notes, tags and transfer flags into the
 * survivor and re-pointing anything that linked to them. Shared by both passes.
 */
async function collapseGroup(
  accountId: string,
  rows: TxRow[],
  label: string,
  commit: boolean,
  stats: GroupStats
): Promise<void> {
  {
    // Safety: skip groups touching splits — Cascade delete would nuke split parts
    if (rows.some((r) => r.isSplitParent || r.parentTransactionId)) {
      console.warn(`    SKIP ${label}: involves split parent/parts`);
      stats.groupsSkipped++;
      return;
    }

    // Safety: skip if merchants are clearly different (legitimate same-day same-amount tx)
    const merchants = rows.map((r) => r.merchantNormalized);
    let allSimilar = true;
    for (let i = 1; i < merchants.length; i++) {
      if (!isMerchantSimilar(merchants[0], merchants[i])) {
        allSimilar = false;
        break;
      }
    }
    if (!allSimilar) {
      console.warn(
        `    SKIP ${label}: merchants differ: ${rows.map((r) => `'${r.merchant}'`).join(' vs ')}`
      );
      stats.groupsSkipped++;
      return;
    }

    // Safety: same externalId shouldn't happen (unique constraint) but guard anyway
    const externalIds = rows.map((r) => r.externalId).filter((x) => x !== null) as string[];
    const distinctExternalIds = new Set(externalIds);
    if (externalIds.length > 1 && distinctExternalIds.size === externalIds.length) {
      // 2+ rows each have their own externalId — both are real Teller records.
      // This typically means duplicate Teller records (post-re-enrollment). Proceed with merge.
    }

    // Pick winner: prefer row with externalId, then newest createdAt
    const sorted = [...rows].sort((a, b) => {
      const aHas = a.externalId ? 1 : 0;
      const bHas = b.externalId ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);

    // Merge fields from losers into winner
    const updates: Partial<TxRow> = {};

    // categoryId: take winner's if set, else best loser by confidence
    if (!winner.categoryId) {
      const bestLoser = losers
        .filter((l) => l.categoryId)
        .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
      if (bestLoser) {
        updates.categoryId = bestLoser.categoryId;
        updates.confidenceScore = bestLoser.confidenceScore;
      }
    } else {
      // winner has categoryId; bump confidence to max across group if any loser had higher
      const maxConfidence = Math.max(
        winner.confidenceScore,
        ...losers.map((l) => l.confidenceScore)
      );
      if (maxConfidence > winner.confidenceScore) updates.confidenceScore = maxConfidence;
    }

    // note: prefer winner; if null, take first loser with a note
    if (!winner.note) {
      const loserWithNote = losers.find((l) => l.note);
      if (loserWithNote?.note) updates.note = loserWithNote.note;
    }

    // tags: union all
    const allTags = new Set<string>();
    for (const r of rows) {
      if (!r.tags) continue;
      try {
        const parsed = JSON.parse(r.tags);
        if (Array.isArray(parsed)) parsed.forEach((t: string) => allTags.add(t));
      } catch {
        // ignore malformed tags
      }
    }
    const winnerTagsCount = winner.tags
      ? (() => {
          try {
            const p = JSON.parse(winner.tags);
            return Array.isArray(p) ? p.length : 0;
          } catch {
            return 0;
          }
        })()
      : 0;
    if (allTags.size > winnerTagsCount) {
      updates.tags = JSON.stringify([...allTags]);
    }

    // isTransfer / transferGroupId / linkedTransactionId: take if any loser has it and winner doesn't
    if (!winner.isTransfer && losers.some((l) => l.isTransfer)) {
      updates.isTransfer = true;
      const transferLoser = losers.find((l) => l.transferGroupId);
      if (transferLoser?.transferGroupId) updates.transferGroupId = transferLoser.transferGroupId;
    }
    if (!winner.linkedTransactionId) {
      const linkedLoser = losers.find((l) => l.linkedTransactionId);
      if (linkedLoser?.linkedTransactionId)
        updates.linkedTransactionId = linkedLoser.linkedTransactionId;
    }

    // isOffset: if winner is false and any loser is true, propagate
    if (!winner.isOffset && losers.some((l) => l.isOffset)) {
      updates.isOffset = true;
    }

    // Find any other transactions pointing AT a loser via linkedTransactionId.
    // Prisma's onDelete: SetNull would silently break those links; re-point to winner instead.
    const loserIds = losers.map((l) => l.id);
    const incomingLinks = await prisma.transaction.findMany({
      where: { linkedTransactionId: { in: loserIds } },
      select: { id: true, merchant: true, linkedTransactionId: true },
    });

    // Stamp importHash so future syncs can dedup even after re-enrollment
    if (!winner.importHash) {
      updates.importHash = createImportHash(
        accountId,
        winner.date,
        winner.amount,
        winner.merchantNormalized
      );
    }

    // Report
    console.warn(
      `    MERGE ${label} merchant='${winner.merchant}' winner=${winner.id.slice(0, 8)}(ext=${winner.externalId?.slice(0, 12) ?? 'null'}) losers=[${losers.map((l) => `${l.id.slice(0, 8)}(ext=${l.externalId?.slice(0, 12) ?? 'null'},cat=${l.categoryId ? 'Y' : 'N'})`).join(', ')}]`
    );
    if (Object.keys(updates).length > 0) {
      console.warn(`      updates: ${JSON.stringify(updates)}`);
    }
    if (incomingLinks.length > 0) {
      console.warn(
        `      repointing ${incomingLinks.length} linkedTransactionId pointer(s) -> winner: ${incomingLinks.map((l) => `${l.id.slice(0, 8)}('${l.merchant}')`).join(', ')}`
      );
    }

    if (commit) {
      // Splits would Cascade-delete children, but we already skipped those above.
      await prisma.$transaction(async (tx) => {
        if (Object.keys(updates).length > 0) {
          await tx.transaction.update({ where: { id: winner.id }, data: updates });
        }
        if (incomingLinks.length > 0) {
          await tx.transaction.updateMany({
            where: { id: { in: incomingLinks.map((l) => l.id) } },
            data: { linkedTransactionId: winner.id },
          });
        }
        for (const loser of losers) {
          await tx.transaction.delete({ where: { id: loser.id } });
        }
      });
    }

    stats.groupsCollapsed++;
    stats.rowsDeleted += losers.length;
  }
}

/**
 * Cross-provider pass.
 *
 * When an institution is moved from one provider to another, the same purchase arrives
 * twice under different external ids AND often on a different date — Teller posts a
 * Venice cafe charge on Jul 2, Plaid reports it on Jul 3. The (date, amount) pass above
 * cannot see those: the two rows never land in the same group.
 *
 * So pair across providers instead: same amount, within `windowDays`, merchant names
 * similar, one row carrying a Teller external id and the other not. A Teller row is
 * matched only when EXACTLY ONE candidate qualifies — two identical-amount charges on
 * the same day (a cafe and a bar, both 10.29) must not be paired by guesswork. The
 * merchant-similarity gate is what disambiguates them.
 */
async function processAccountCrossProvider(
  accountId: string,
  accountName: string,
  windowDays: number,
  commit: boolean
): Promise<GroupStats> {
  const stats: GroupStats = {
    totalGroups: 0,
    groupsCollapsed: 0,
    groupsSkipped: 0,
    rowsDeleted: 0,
  };

  const rows = (await prisma.transaction.findMany({
    where: { accountId, externalId: { not: null } },
    orderBy: { date: 'asc' },
  })) as TxRow[];

  // Teller mints ids prefixed `txn_`; Plaid's are opaque base62. That prefix is the only
  // provenance we have — the connection rows say what an account syncs through *now*,
  // not what wrote a given transaction.
  const isTeller = (r: TxRow) => !!r.externalId?.startsWith('txn_');
  const tellerRows = rows.filter(isTeller);
  const otherRows = rows.filter((r) => !isTeller(r));

  if (tellerRows.length === 0 || otherRows.length === 0) {
    console.warn(`  [${accountName}] no cross-provider overlap`);
    return stats;
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const claimed = new Set<string>();

  for (const tellerRow of tellerRows) {
    const candidates = otherRows.filter(
      (o) =>
        !claimed.has(o.id) &&
        o.amount === tellerRow.amount &&
        Math.abs(o.date.getTime() - tellerRow.date.getTime()) <= windowMs &&
        isMerchantSimilar(tellerRow.merchantNormalized, o.merchantNormalized)
    );

    if (candidates.length === 0) continue;

    stats.totalGroups++;

    if (candidates.length > 1) {
      console.warn(
        `    SKIP ${tellerRow.date.toISOString().slice(0, 10)} amt=${tellerRow.amount}: ` +
          `'${tellerRow.merchant}' matches ${candidates.length} rows ` +
          `(${candidates.map((c) => `'${c.merchant}'`).join(', ')}) — too ambiguous to pair`
      );
      stats.groupsSkipped++;
      continue;
    }

    const match = candidates[0];
    claimed.add(match.id);

    const label =
      `${tellerRow.date.toISOString().slice(0, 10)}->${match.date.toISOString().slice(0, 10)} ` +
      `amt=${tellerRow.amount}`;

    // Newest createdAt wins in collapseGroup, which is the newly synced provider row —
    // exactly what we want, so future syncs match on its external id.
    await collapseGroup(accountId, [match, tellerRow], label, commit, stats);
  }

  if (stats.totalGroups === 0) {
    console.warn(`  [${accountName}] no cross-provider duplicates found`);
  }

  return stats;
}

async function main() {
  const args = parseArgs();

  console.warn(
    `Mode: ${args.commit ? 'COMMIT (changes will be written)' : 'DRY-RUN (no changes)'}`
  );
  if (args.institution) console.warn(`Filter: institution contains '${args.institution}'`);
  if (args.accountId) console.warn(`Filter: accountId=${args.accountId}`);

  const accounts = await prisma.account.findMany({
    where: {
      ...(args.accountId ? { id: args.accountId } : {}),
      ...(args.institution ? { institution: { contains: args.institution } } : {}),
    },
    select: { id: true, name: true, institution: true },
  });

  if (accounts.length === 0) {
    console.warn('No accounts matched filter.');
    await prisma.$disconnect();
    return;
  }

  console.warn(`\nProcessing ${accounts.length} account(s):`);

  const totals: GroupStats = {
    totalGroups: 0,
    groupsCollapsed: 0,
    groupsSkipped: 0,
    rowsDeleted: 0,
  };

  const add = (stats: GroupStats) => {
    totals.totalGroups += stats.totalGroups;
    totals.groupsCollapsed += stats.groupsCollapsed;
    totals.groupsSkipped += stats.groupsSkipped;
    totals.rowsDeleted += stats.rowsDeleted;
  };

  for (const acct of accounts) {
    const label = `${acct.name} (${acct.institution})`;
    console.warn(`\n${label}`);
    add(await processAccount(acct.id, label, args.commit));

    // Runs second on purpose: the exact-match pass collapses the unambiguous cases
    // first, so the cross-provider pass sees fewer rows and fewer chances to mispair.
    if (args.crossProvider) {
      add(await processAccountCrossProvider(acct.id, label, args.windowDays, args.commit));
    }
  }

  console.warn(`\n=== Summary ===`);
  console.warn(`Duplicate groups found:    ${totals.totalGroups}`);
  console.warn(`Groups collapsed:          ${totals.groupsCollapsed}`);
  console.warn(`Groups skipped (unsafe):   ${totals.groupsSkipped}`);
  console.warn(`Rows ${args.commit ? 'deleted' : 'would be deleted'}: ${totals.rowsDeleted}`);

  if (!args.commit && totals.groupsCollapsed > 0) {
    console.warn(`\nDry run complete. Re-run with --commit to apply changes.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
