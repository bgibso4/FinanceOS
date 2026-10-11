/**
 * One-shot migration: convert manual balance_only investment accounts into investment accounts
 * in place (ids preserved), replaying their "Balance Adjustment" history into AccountBalance and
 * linking Plaid investment accounts. Account mapping comes from a LOCAL JSON file that must never
 * be committed (the repo is public).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/migrate-investment-accounts.ts <config.json>          # dry run
 *   npx tsx --env-file=.env scripts/migrate-investment-accounts.ts <config.json> --apply  # backup + write + first sync
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { getPlaidClient } from '../src/lib/plaid';
import { decryptAccessToken } from '../src/lib/encryption';
import {
  buildMigrationPlan,
  applyMigrationPlan,
  type PlaidAccountRef,
} from '../src/lib/investments/migration';
import { syncPlaidInvestments } from '../src/lib/investments/plaid-investment-sync';
import { recordInvestmentSyncStatus } from '../src/lib/investments/sync-status';

const APPLY = process.argv.includes('--apply');

/** Backs up the live database via the open connection; returns the backup path. */
async function backupDatabase(): Promise<string> {
  const rows =
    await prisma.$queryRawUnsafe<{ name: string; file: string }[]>('PRAGMA database_list');
  const file = rows.find((r) => r.name === 'main')?.file;
  if (!file) throw new Error('Could not determine the main database file; aborting');
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  if (!existsSync(backup) || statSync(backup).size === 0) {
    throw new Error(`Backup ${backup} is missing or empty; aborting before any write`);
  }
  return backup;
}

async function loadPlaidAccounts(): Promise<PlaidAccountRef[]> {
  const plaid = getPlaidClient();
  const refs: PlaidAccountRef[] = [];
  for (const e of await prisma.plaidEnrollment.findMany()) {
    const access_token = decryptAccessToken(e.accessTokenEncrypted, e.accessTokenIv);
    const res = await plaid.accountsGet({ access_token });
    for (const a of res.data.accounts) {
      refs.push({
        enrollmentId: e.id,
        institutionName: e.institutionName,
        accountId: a.account_id,
        name: a.name,
        mask: a.mask ?? null,
        type: a.type,
        subtype: a.subtype ?? null,
      });
    }
  }
  return refs;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath || configPath.startsWith('--'))
    throw new Error('Usage: migrate-investment-accounts.ts <config.json> [--apply]');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  console.warn(`\n=== Investment account migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const plan = await buildMigrationPlan(prisma, config, await loadPlaidAccounts());

  for (const c of plan.convert) {
    console.warn(
      `CONVERT ${c.accountName} → investment/${c.balanceSource}${c.plaid ? ` · Plaid ${c.plaid.institutionName} ••••${c.plaid.mask}` : ''}`
    );
    for (const b of c.balances)
      console.warn(
        `    ${b.date.toISOString().slice(0, 10)}  ${b.balance.toFixed(2)} ${c.currency}`
      );
    console.warn(`    delete ${c.adjustmentIds.length} adjustment transaction(s)`);
  }
  for (const c of plan.create)
    console.warn(
      `CREATE ${c.name} (${c.type}) · Plaid ${c.plaid.institutionName} ••••${c.plaid.mask}`
    );
  for (const s of plan.skipped) console.warn(`SKIP ${s.accountId}: ${s.reason}`);

  if (!APPLY) {
    console.warn('\nDry run only. Re-run with --apply to write.');
    return;
  }

  const backup = await backupDatabase();
  console.warn(`\nBacked up database to ${backup}`);

  const { convertedAccountIds, createdAccountIds } = await applyMigrationPlan(prisma, plan);
  console.warn(`Converted ${convertedAccountIds.length}, created ${createdAccountIds.length}.`);

  const connections = await prisma.plaidConnection.findMany({
    where: { accountId: { in: [...convertedAccountIds, ...createdAccountIds] } },
    include: { account: true, plaidEnrollment: true },
  });
  let failed = 0;
  for (const conn of connections) {
    try {
      const r = await syncPlaidInvestments(conn);
      await recordInvestmentSyncStatus(prisma, r);
      console.warn(
        `  synced ${conn.account.name}: ${JSON.stringify(r.steps)} ${JSON.stringify(r.counts)}`
      );
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  sync FAILED for ${conn.account.name}: ${message}`);
    }
  }
  console.warn(`First sync: ${connections.length - failed} ok, ${failed} failed.`);
  if (failed) {
    console.warn('The regular Settings sync will retry the failed accounts.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
