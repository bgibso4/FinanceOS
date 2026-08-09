/**
 * One-shot migration: re-point the Chase accounts from Teller to Plaid.
 *
 * Teller Connect stopped working and Teller stopped delivering Chase transactions
 * after 2026-07-06, so Chase was re-linked through Plaid. This moves the existing
 * FinanceOS accounts onto the Plaid enrollment rather than creating new ones —
 * transactions are keyed to `Account`, not to the connection, so all history is
 * preserved untouched and the user's account names survive (Plaid reports all three
 * cards as the generic "CREDIT CARD").
 *
 * Matching is by last four, verified unambiguous before writing. The Teller
 * enrollment is left in place, marked disconnected, at the user's request.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/migrate-chase-teller-to-plaid.ts          # dry run
 *   npx tsx --env-file=.env scripts/migrate-chase-teller-to-plaid.ts --apply  # write
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

type PlaidRawAccount = {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
};

async function main() {
  const label = APPLY ? 'APPLY' : 'DRY RUN';
  console.warn(`\n=== Chase Teller → Plaid migration (${label}) ===\n`);

  const tellerEnrollment = await prisma.tellerEnrollment.findFirst({
    where: { institutionName: 'Chase' },
    include: { connections: { include: { account: true } } },
  });
  const plaidEnrollment = await prisma.plaidEnrollment.findFirst({
    where: { institutionName: 'Chase' },
  });

  if (!tellerEnrollment) throw new Error('No Teller Chase enrollment found');
  if (!plaidEnrollment) throw new Error('No Plaid Chase enrollment found');

  const cached = plaidEnrollment.cachedAccounts;
  if (!cached) {
    throw new Error(
      'Plaid Chase enrollment has no cached account list. Load Settings once (or hit ' +
        '/api/plaid/enrollment?refresh=1) so the list is cached, then re-run.'
    );
  }
  const plaidAccounts: PlaidRawAccount[] = JSON.parse(cached);

  // Refuse to guess. Every Teller connection must map to exactly one Plaid account by
  // last four, and no two connections may claim the same one.
  const planned: Array<{
    accountId: string;
    accountName: string;
    lastFour: string;
    tellerConnectionId: string;
    plaid: PlaidRawAccount;
  }> = [];
  const claimed = new Set<string>();

  for (const conn of tellerEnrollment.connections) {
    const lastFour = conn.tellerAccountLastFour;
    if (!lastFour) throw new Error(`Connection ${conn.id} has no last four — cannot match`);

    const matches = plaidAccounts.filter((p) => p.mask === lastFour);
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly 1 Plaid account matching ••••${lastFour}, found ${matches.length}`
      );
    }
    const match = matches[0];
    if (claimed.has(match.account_id)) {
      throw new Error(`Plaid account ${match.account_id} matched by two connections`);
    }
    claimed.add(match.account_id);

    planned.push({
      accountId: conn.accountId,
      accountName: conn.account.name,
      lastFour,
      tellerConnectionId: conn.id,
      plaid: match,
    });
  }

  for (const p of planned) {
    const txns = await prisma.transaction.count({ where: { accountId: p.accountId } });
    console.warn(`  ${p.accountName} (••••${p.lastFour}) — ${txns} transactions preserved`);
    console.warn(`      teller connection ${p.tellerConnectionId}  ->  DELETE`);
    console.warn(`      plaid  connection ${p.plaid.account_id}  ->  CREATE`);
  }

  const unlinked = plaidAccounts.filter((p) => !claimed.has(p.account_id));
  if (unlinked.length > 0) {
    console.warn('\n  Left for you to adopt in the UI (they are not existing accounts):');
    for (const u of unlinked) console.warn(`      ••••${u.mask} ${u.name}`);
  }

  if (!APPLY) {
    console.warn('\nDry run — nothing written. Re-run with --apply to execute.\n');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of planned) {
      await tx.tellerConnection.delete({ where: { id: p.tellerConnectionId } });
      await tx.plaidConnection.create({
        data: {
          accountId: p.accountId,
          plaidEnrollmentId: plaidEnrollment.id,
          plaidAccountId: p.plaid.account_id,
          plaidAccountName: p.plaid.name,
          plaidAccountType: p.plaid.type,
          plaidAccountSubtype: p.plaid.subtype ?? null,
          plaidAccountMask: p.plaid.mask ?? null,
          status: 'connected',
        },
      });
    }

    // Kept at the user's request rather than deleted. Its connections are gone, so the
    // onDelete: Cascade on TellerConnection has nothing left to take either way.
    await tx.tellerEnrollment.update({
      where: { id: tellerEnrollment.id },
      data: { status: 'disconnected' },
    });
  });

  console.warn(`\nApplied. ${planned.length} accounts now sync through Plaid.`);
  console.warn('Teller Chase enrollment kept, marked disconnected.\n');
}

main()
  .catch((e) => {
    console.error(
      '\nMigration failed, nothing partially applied (all writes are in one transaction):'
    );
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
