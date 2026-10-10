/**
 * Read-only probe: dump what Plaid returns for investment institutions so we can design
 * how Fidelity/Schwab merge into the existing manual balance_only accounts.
 *
 * Writes raw JSON (accounts, holdings, securities, investment transactions, cash
 * transactions) per enrollment to the output directory and prints a summary. Never writes
 * to the database. Keep the output out of the repo — it is raw financial data.
 *
 * Note: the first /investments/transactions/get call starts Plaid's Investments
 * Transactions subscription for the Item.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/probe-plaid-investments.ts <outDir> [institutionName...]
 *   (defaults to Fidelity and Schwab)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { InvestmentTransaction, Transaction } from 'plaid';
import { getPlaidClient } from '../src/lib/plaid';
import { decryptAccessToken } from '../src/lib/encryption';

const prisma = new PrismaClient();
const HISTORY_DAYS = 730; // Plaid's max for investment transactions (24 months)

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function plaidErrorOf(error: unknown): unknown {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: unknown } }).response?.data ?? String(error);
  }
  return String(error);
}

async function main() {
  const [outDir, ...names] = process.argv.slice(2);
  if (!outDir) throw new Error('Usage: probe-plaid-investments.ts <outDir> [institutionName...]');
  const institutions = names.length ? names : ['Fidelity', 'Schwab'];

  const enrollments = await prisma.plaidEnrollment.findMany({
    where: { OR: institutions.map((n) => ({ institutionName: { contains: n } })) },
  });
  if (!enrollments.length) {
    console.warn(`No Plaid enrollments matching: ${institutions.join(', ')}`);
    return;
  }

  const plaid = getPlaidClient();
  const end = new Date();
  const start = new Date(end.getTime() - HISTORY_DAYS * 86_400_000);

  for (const enrollment of enrollments) {
    const accessToken = decryptAccessToken(
      enrollment.accessTokenEncrypted,
      enrollment.accessTokenIv
    );
    const dir = join(outDir, enrollment.institutionName.replace(/[^\w-]+/g, '_'));
    mkdirSync(dir, { recursive: true });
    const save = (file: string, data: unknown) =>
      writeFileSync(join(dir, file), JSON.stringify(data, null, 2));

    console.warn(`\n=== ${enrollment.institutionName} (${enrollment.plaidItemId}) ===`);

    const item = await plaid.itemGet({ access_token: accessToken });
    save('item.json', item.data);
    console.warn(`products: ${(item.data.item.products ?? []).join(', ')}`);

    const accounts = await plaid.accountsGet({ access_token: accessToken });
    save('accounts.json', accounts.data);
    for (const a of accounts.data.accounts) {
      console.warn(
        `  ${a.account_id.slice(0, 8)}  ${a.type}/${a.subtype}  ${a.name} (${a.mask ?? '----'})` +
          `  current=${a.balances.current} ${a.balances.iso_currency_code ?? ''}`
      );
    }

    try {
      const holdings = await plaid.investmentsHoldingsGet({ access_token: accessToken });
      save('holdings.json', holdings.data);
      console.warn(
        `holdings: ${holdings.data.holdings.length}, securities: ${holdings.data.securities.length}`
      );
    } catch (error) {
      save('holdings.error.json', plaidErrorOf(error));
      console.warn('holdings: ERROR (see holdings.error.json)');
    }

    try {
      const invTxns: InvestmentTransaction[] = [];
      let securities: unknown[] = [];
      let total = Infinity;
      while (invTxns.length < total) {
        const res = await plaid.investmentsTransactionsGet({
          access_token: accessToken,
          start_date: isoDate(start),
          end_date: isoDate(end),
          options: { count: 500, offset: invTxns.length },
        });
        total = res.data.total_investment_transactions;
        securities = res.data.securities;
        invTxns.push(...res.data.investment_transactions);
        if (!res.data.investment_transactions.length) break;
      }
      save('investment-transactions.json', { investment_transactions: invTxns, securities });
      const byType = new Map<string, number>();
      for (const t of invTxns) {
        const key = `${t.type}/${t.subtype}`;
        byType.set(key, (byType.get(key) ?? 0) + 1);
      }
      const dates = invTxns.map((t) => t.date).sort();
      console.warn(
        `investment transactions: ${invTxns.length} (${dates[0] ?? '-'} → ${dates[dates.length - 1] ?? '-'})`
      );
      for (const [k, n] of [...byType].sort((a, b) => b[1] - a[1])) console.warn(`  ${n}\t${k}`);
    } catch (error) {
      save('investment-transactions.error.json', plaidErrorOf(error));
      console.warn('investment transactions: ERROR (see investment-transactions.error.json)');
    }

    // /transactions/get (not /sync) so we don't touch any stored cursor
    try {
      const txns: Transaction[] = [];
      let total = Infinity;
      while (txns.length < total) {
        const res = await plaid.transactionsGet({
          access_token: accessToken,
          start_date: isoDate(start),
          end_date: isoDate(end),
          options: { count: 500, offset: txns.length },
        });
        total = res.data.total_transactions;
        txns.push(...res.data.transactions);
        if (!res.data.transactions.length) break;
      }
      save('transactions.json', txns);
      console.warn(`cash transactions: ${txns.length}`);
    } catch (error) {
      save('transactions.error.json', plaidErrorOf(error));
      console.warn('cash transactions: ERROR (see transactions.error.json)');
    }
  }

  console.warn(`\nRaw output written to ${outDir}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
