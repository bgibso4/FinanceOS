/**
 * Repair `importHash` on Transaction rows where it is missing OR stale.
 *
 * Missing: rows inserted before the importHash dedup tier existed.
 *
 * Stale: the hash covers (accountId, date, amount, merchantNormalized), so editing any
 * of those leaves a hash describing the row's old values. A later sync of the same
 * transaction computes the correct hash, matches nothing, and inserts a duplicate. The
 * PATCH route now recomputes on edit, but rows edited before that fix — or changed
 * directly in the database — still carry stale hashes.
 *
 * Usage:
 *   npx tsx scripts/backfill-import-hash.ts            # dry-run
 *   npx tsx scripts/backfill-import-hash.ts --commit   # apply
 */

import { prisma } from '../src/lib/prisma';
import { createImportHash } from '../src/lib/sync-common';

const commit = process.argv.includes('--commit');

async function main() {
  const candidates = await prisma.transaction.findMany({
    select: {
      id: true,
      accountId: true,
      date: true,
      amount: true,
      merchantNormalized: true,
      importHash: true,
    },
  });

  // Recompute everything and keep only the rows whose stored value disagrees.
  let missingCount = 0;
  let staleCount = 0;
  const rows = candidates.filter((r) => {
    const expected = createImportHash(r.accountId, r.date, r.amount, r.merchantNormalized);
    if (!r.importHash) {
      missingCount++;
      return true;
    }
    if (r.importHash !== expected) {
      staleCount++;
      return true;
    }
    return false;
  });

  console.warn(
    `${commit ? 'COMMIT' : 'DRY-RUN'}: ${rows.length} transactions need importHash ` +
      `(${missingCount} missing, ${staleCount} stale) of ${candidates.length} scanned`
  );
  if (rows.length === 0) {
    await prisma.$disconnect();
    return;
  }

  // Group by hash to detect collisions (rows that will end up with the same hash
  // are duplicates that the cleanup script should have collapsed).
  const hashGroups = new Map<string, string[]>();
  for (const r of rows) {
    const hash = createImportHash(r.accountId, r.date, r.amount, r.merchantNormalized);
    const list = hashGroups.get(hash) ?? [];
    list.push(r.id);
    hashGroups.set(hash, list);
  }

  const collisions = [...hashGroups.entries()].filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    console.warn(
      `\n⚠ ${collisions.length} hash collision(s) — these are duplicate rows that survived cleanup:`
    );
    for (const [hash, ids] of collisions.slice(0, 20)) {
      console.warn(`  hash=${hash.slice(0, 12)} ids=[${ids.map((i) => i.slice(0, 8)).join(', ')}]`);
    }
    if (collisions.length > 20) console.warn(`  ...and ${collisions.length - 20} more`);
    console.warn(
      `\nNote: backfill stamps each row with its computed hash regardless — collisions stay,`
    );
    console.warn(
      `but future syncs will skip them as duplicates. Re-run cleanup-duplicates.ts to merge.`
    );
  }

  if (!commit) {
    console.warn(`\nDry-run complete. Re-run with --commit to write.`);
    await prisma.$disconnect();
    return;
  }

  // Batch updates in chunks
  let updated = 0;
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map((r) =>
        prisma.transaction.update({
          where: { id: r.id },
          data: {
            importHash: createImportHash(r.accountId, r.date, r.amount, r.merchantNormalized),
          },
        })
      )
    );
    updated += batch.length;
    if (updated % 200 === 0 || updated === rows.length) {
      console.warn(`  updated ${updated}/${rows.length}`);
    }
  }

  console.warn(`\nDone. Stamped importHash on ${updated} rows.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
