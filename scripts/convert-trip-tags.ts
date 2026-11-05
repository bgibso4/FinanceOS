/**
 * One-off: convert "YYYY - Name" trip tags into trips (see the Travel design, section 2).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/convert-trip-tags.ts           # dry run: prints the plan
 *   npx tsx --env-file=.env scripts/convert-trip-tags.ts --apply   # backup + write
 */
import { prisma } from '../src/lib/prisma';
import { applyTripConversionPlan, buildTripConversionPlan } from '../src/lib/travel/tag-conversion';
import { backupDatabase } from './lib/backup-db';

const APPLY = process.argv.includes('--apply');

async function main() {
  const plan = await buildTripConversionPlan(prisma);
  if (!plan.trips.length && !plan.skipped.length && !plan.travelGoalIds.length) {
    console.warn('Nothing to convert.');
    return;
  }

  console.warn(`\n=== Trip tag conversion (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  for (const t of plan.trips)
    console.warn(
      `TRIP ${t.name}  ${t.startDate} .. ${t.endDate}  ${t.transactionIds.length} transaction(s)  (tag "${t.tagName}" will be removed)`
    );
  for (const s of plan.skipped)
    console.warn(`SKIP tag "${s.tagName}": ${s.reason}; left untouched`);
  console.warn(`GOALS switching to travel tracking: ${plan.travelGoalIds.length}`);
  for (const w of plan.warnings) console.warn(`WARNING ${w}`);

  if (!APPLY) {
    console.warn('\nDry run only. Re-run with --apply to write.');
    return;
  }
  const backup = await backupDatabase(prisma);
  console.warn(`\nBacked up database to ${backup}`);
  await applyTripConversionPlan(prisma, plan);
  console.warn(`Created ${plan.trips.length} trip(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
