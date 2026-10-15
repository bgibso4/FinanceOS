/**
 * Re-runs the stored-code rename by hand and prints what changed (spec 2026-10-13 §3). The app
 * already runs it once per server process; this is for checking or re-running it.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/rename-stored-codes.ts
 */
import { prisma } from '../src/lib/prisma';
import { renameStoredSourceCodes } from '../src/lib/investments/rename-stored-codes';

async function main() {
  const counts = await renameStoredSourceCodes(prisma);
  for (const c of counts) {
    const dropped = c.dropped ? `, ${c.dropped} duplicate(s) dropped` : '';
    console.warn(`${c.column}: ${c.from} → ${c.to}: ${c.renamed} renamed${dropped}`);
  }
  const total = counts.reduce((sum, c) => sum + c.renamed + c.dropped, 0);
  console.warn(total ? `Done: ${total} row(s) changed.` : 'Nothing to rename; already up to date.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
