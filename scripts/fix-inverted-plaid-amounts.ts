/**
 * Repair amounts on accounts left with `invertAmounts` set after a provider migration.
 *
 * Teller reports outflows negative (bank-statement style); Plaid reports them positive.
 * `convertBankAmount` negates the provider's value, and `invertAmounts` negates it again
 * for accounts whose provider uses the opposite convention. An account that legitimately
 * needed the flag on Teller therefore double-inverts once it is moved to Plaid, and every
 * transaction imported after the move lands with the wrong sign — bills as income,
 * deposits as spending, and credit-card payments that transfer detection can no longer
 * pair because both sides end up positive.
 *
 * This flips the sign on rows imported by the *new* provider only (Teller-era rows were
 * correct under the old flag and must not be touched), recomputes their importHash, which
 * is derived from the amount, clears the flag, and re-runs transfer detection over the
 * repaired rows.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/fix-inverted-plaid-amounts.ts            # dry run
 *   npx tsx --env-file=.env scripts/fix-inverted-plaid-amounts.ts --commit
 *   npx tsx --env-file=.env scripts/fix-inverted-plaid-amounts.ts --account=<id>
 */
import { prisma } from '../src/lib/prisma';
import { createImportHash, detectTransfers } from '../src/lib/sync-common';

const COMMIT = process.argv.includes('--commit');
const ACCOUNT_ARG = process.argv
  .find((a) => a.startsWith('--account='))
  ?.slice('--account='.length);

/** Teller mints ids prefixed `txn_`; anything else non-null came from Plaid. */
const isTellerId = (externalId: string | null) => !!externalId?.startsWith('txn_');

async function main() {
  console.warn(`\n=== Fix inverted Plaid amounts (${COMMIT ? 'COMMIT' : 'DRY RUN'}) ===\n`);

  const accounts = await prisma.account.findMany({
    where: {
      invertAmounts: true,
      plaidConnection: { isNot: null },
      ...(ACCOUNT_ARG ? { id: ACCOUNT_ARG } : {}),
    },
    include: { plaidConnection: true },
  });

  if (accounts.length === 0) {
    console.warn('No accounts with invertAmounts set are on Plaid. Nothing to do.');
    return;
  }

  let totalRows = 0;

  for (const account of accounts) {
    // Only rows the new provider wrote. Teller-era rows were imported under the flag and
    // are already correct; flipping them would break what is currently right.
    const rows = await prisma.transaction.findMany({
      where: { accountId: account.id, externalId: { not: null } },
      orderBy: { date: 'asc' },
    });
    const plaidRows = rows.filter((r) => !isTellerId(r.externalId));

    console.warn(`${account.name} (invertAmounts=true, ${plaidRows.length} Plaid-era rows)`);
    if (plaidRows.length === 0) {
      console.warn('  nothing to flip\n');
      continue;
    }

    for (const r of plaidRows.slice(0, 8)) {
      const d = r.date.toISOString().slice(0, 10);
      console.warn(
        `  ${d}  ${r.merchant.slice(0, 30).padEnd(30)} ${String(r.amount).padStart(10)} -> ${String(-r.amount).padStart(10)}`
      );
    }
    if (plaidRows.length > 8) console.warn(`  … and ${plaidRows.length - 8} more`);

    totalRows += plaidRows.length;

    if (!COMMIT) {
      console.warn('');
      continue;
    }

    await prisma.$transaction(async (tx) => {
      for (const r of plaidRows) {
        const flipped = -r.amount;
        await tx.transaction.update({
          where: { id: r.id },
          data: {
            amount: flipped,
            // importHash is built from the amount, so a stale hash would defeat dedup
            // on every future sync of these rows.
            importHash: createImportHash(account.id, r.date, flipped, r.merchantNormalized),
          },
        });
      }
      await tx.account.update({ where: { id: account.id }, data: { invertAmounts: false } });
    });

    console.warn(`  flipped ${plaidRows.length} rows, cleared invertAmounts`);

    // Both sides of a credit-card payment were positive before the flip, so detection
    // could never pair them. Re-run it now that the signs oppose properly.
    const result = await detectTransfers(account.id, new Set(plaidRows.map((r) => r.id)));
    console.warn(
      `  transfer detection: ${result.transfersDetected} detected ` +
        `(${result.crossAccount} cross-account, ${result.sameAccount} same-account)\n`
    );
  }

  console.warn(`\n=== Summary ===`);
  console.warn(`Accounts affected: ${accounts.length}`);
  console.warn(`Rows ${COMMIT ? 'flipped' : 'that would be flipped'}: ${totalRows}`);
  if (!COMMIT) console.warn('\nDry run — nothing written. Re-run with --commit to apply.\n');
}

main()
  .catch((e) => {
    console.error('\nFailed (all writes are inside one transaction, so nothing is partial):');
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
