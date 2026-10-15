/**
 * Switch manual investment accounts to Valued (holdings × price) from a local, uncommitted file,
 * and backfill the single-holding mirror for accounts that stay manual.
 * Dry run by default; --apply backs up the database first.
 *   npx tsx scripts/set-valuation-holdings.ts ~/Documents/FinanceOS-private/valuation-holdings.json [--apply]
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import { getAccountBalance } from '../src/lib/balances';
import { convertAmount, isValidCurrency } from '../src/lib/currency';
import { loadFxRates } from '../src/lib/prices/price-book';
import { YahooPriceProvider } from '../src/lib/prices/yahoo';
import { createInvestmentServices } from '../src/lib/investments/services';
import { ensureStoredCodes } from '../src/lib/investments/rename-stored-codes';
import { backupDatabase } from './lib/backup-db';
import { BalanceSource } from '../src/lib/investments/codes';

const FileSchema = z.object({
  accounts: z
    .array(
      z
        .object({
          accountId: z.string().min(1),
          holdings: z
            .array(
              z.object({
                symbol: z.string().trim().toUpperCase().min(1),
                quantity: z.number().positive(),
              })
            )
            .superRefine((holdings, ctx) => {
              const seen = new Set<string>();
              for (const h of holdings) {
                if (seen.has(h.symbol)) {
                  ctx.addIssue({ code: 'custom', message: `Duplicate symbol ${h.symbol}` });
                }
                seen.add(h.symbol);
              }
            })
            .default([]),
          cash: z
            .record(
              z
                .string()
                .trim()
                .toUpperCase()
                .refine(isValidCurrency, { message: 'Unsupported currency' }),
              z.number().positive()
            )
            .default({}),
        })
        .refine((entry) => entry.holdings.length > 0 || Object.keys(entry.cash).length > 0, {
          message: 'Each account needs at least one holding or cash amount',
        })
    )
    .min(1),
});

const APPLY = process.argv.includes('--apply');
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

async function main() {
  const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!path) throw new Error('Usage: set-valuation-holdings.ts <holdings.json> [--apply]');
  const config = FileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  await ensureStoredCodes(prisma);
  const services = createInvestmentServices({ prisma, provider: new YahooPriceProvider() });
  const rates = await loadFxRates(prisma);

  for (const entry of config.accounts) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: entry.accountId } });
    if (account.trackingMode !== 'investment' || account.balanceSource === BalanceSource.Provider) {
      throw new Error(`${account.name}: must be a manual or valued investment account`);
    }
    const current = await getAccountBalance(prisma, account.id);
    console.warn(`\n${account.name} (${account.currency}) — current ${fmt(current.balance)}`);
    let total = 0;
    for (const h of entry.holdings) {
      const quote = await services.quotes.get(h.symbol);
      const value = convertAmount(
        h.quantity * quote.price,
        quote.currency,
        account.currency,
        rates
      );
      total += value;
      console.warn(
        `  ${h.symbol}: ${h.quantity} × ${fmt(quote.price)} ${quote.currency} = ${fmt(value)}`
      );
    }
    for (const [currency, amount] of Object.entries(entry.cash)) {
      const value = convertAmount(amount, currency, account.currency, rates);
      total += value;
      console.warn(`  ${currency} cash: ${fmt(amount)} = ${fmt(value)}`);
    }
    console.warn(`  valued at ~${fmt(total)} (latest quotes; stored closes may differ)`);
  }

  if (!APPLY) {
    console.warn('\nDry run — nothing written. Re-run with --apply to switch these accounts.');
    return;
  }

  console.warn(`\nBackup: ${await backupDatabase(prisma)}`);
  for (const entry of config.accounts) {
    const holdings = [];
    for (const h of entry.holdings) {
      const { security } = await services.catalog.findOrCreateMarket(h.symbol);
      holdings.push({ securityId: security.id, quantity: h.quantity });
    }
    for (const [currency, amount] of Object.entries(entry.cash)) {
      const security = await services.catalog.findOrCreateCash(currency);
      holdings.push({ securityId: security.id, quantity: amount });
    }
    await prisma.account.update({
      where: { id: entry.accountId },
      data: { balanceSource: BalanceSource.Valuation },
    });
    const { prices } = await services.refresh.saveHoldings(entry.accountId, holdings);
    if (prices.stopped) {
      console.warn(
        `${entry.accountId}: price refresh stopped (${prices.error}); its valued balance will fill in on the next POST /api/investments/refresh`
      );
    }
    const after = await getAccountBalance(prisma, entry.accountId);
    console.warn(`Switched ${entry.accountId}: balance ${fmt(after.balance)} (${after.source})`);
  }
  // One-time backfill: migrated manual entries predate the single-holding mirror.
  console.warn(`Manual holdings rebuilt for ${await services.manualHoldings.syncAll()} account(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
