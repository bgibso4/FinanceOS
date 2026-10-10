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
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { getPlaidClient } from '../src/lib/plaid';
import { decryptAccessToken } from '../src/lib/encryption';
import {
  buildMigrationPlan,
  applyMigrationPlan,
  type PlaidAccountRef,
} from '../src/lib/investments/migration';
import { syncPlaidInvestments } from '../src/lib/investments/plaid-investment-sync';

const APPLY = process.argv.includes('--apply');

function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  const file = url.replace(/^file:/, '').split('?')[0];
  return resolve(
    file.startsWith('./') && !file.startsWith('./prisma') ? `prisma/${file.slice(2)}` : file
  );
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

  const db = dbFilePath();
  const backup = `${db}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(db, backup);
  console.warn(`\nBacked up database to ${backup}`);

  const { convertedAccountIds, createdAccountIds } = await applyMigrationPlan(prisma, plan);
  console.warn(`Converted ${convertedAccountIds.length}, created ${createdAccountIds.length}.`);

  const connections = await prisma.plaidConnection.findMany({
    where: { accountId: { in: [...convertedAccountIds, ...createdAccountIds] } },
    include: { account: true, plaidEnrollment: true },
  });
  for (const conn of connections) {
    const r = await syncPlaidInvestments(conn);
    console.warn(
      `  synced ${conn.account.name}: ${JSON.stringify(r.steps)} ${JSON.stringify(r.counts)}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
