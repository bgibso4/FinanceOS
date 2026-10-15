import type { PlaidApi, Security as PlaidSecurity } from 'plaid';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { decryptAccessToken } from '@/lib/encryption';
import { classifyPlaidError } from '@/lib/bank-errors';
import { retryWithBackoff, RateLimitError } from '@/lib/sync-common';
import { utcDay, addDays, isoDay } from './dates';
import { linkInvestmentTransfers } from './transfer-linking';
import {
  mapSecurity,
  mapHolding,
  mapInvestmentTransaction,
  mapCashTransaction,
  type MappedInvestmentTransaction,
} from './plaid-mapping';
import { BalanceRowSource, PriceSource, Pricing, RecordSource } from './codes';

export type StepStatus = 'ok' | 'pending' | 'error' | 'skipped';
export type InvestmentStep = 'balance' | 'holdings' | 'transactions' | 'linking';

export type InvestmentSyncResult = {
  accountId: string;
  steps: Record<InvestmentStep, StepStatus>;
  errors: Partial<Record<InvestmentStep, string>>;
  counts: { holdings: number; transactions: number; cancelled: number; linked: number };
};

export type InvestmentConnection = {
  accountId: string;
  plaidAccountId: string;
  plaidAccountType: string | null;
  account: { id: string; currency: string };
  plaidEnrollment: { accessTokenEncrypted: string; accessTokenIv: string };
};

const OVERLAP_DAYS = 30;
const PAGE = 500;
/** How far back Plaid returns investment transactions (24 months). */
const PLAID_TRADE_HISTORY_DAYS = 730;

async function plaidCall<T>(fn: () => Promise<T>): Promise<T> {
  return retryWithBackoff(async () => {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 429) throw new RateLimitError('Plaid API rate limited (429)', 5000);
      throw error;
    }
  });
}

async function upsertSecurities(securities: PlaidSecurity[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const s of securities) {
    const m = mapSecurity(s);
    const existing = await prisma.security.findUnique({
      where: { plaidSecurityId: m.plaidSecurityId },
    });
    const descriptive = {
      ticker: m.ticker,
      name: m.name,
      type: m.type,
      currency: m.currency,
      exchangeMic: m.exchangeMic,
    };
    if (existing) {
      // Never clobber a user-set price symbol; pricing follows the symbol. A symbol the market data
      // provider rejected stays unpriced until Plaid reports a different one.
      const keepUnpriced =
        existing.pricing === Pricing.None && existing.priceSymbol === m.priceSymbol;
      const pricingFields =
        existing.priceSymbolOverride || keepUnpriced
          ? {}
          : { priceSymbol: m.priceSymbol, pricing: m.pricing, fixedPrice: m.fixedPrice };
      await prisma.security.update({
        where: { id: existing.id },
        data: { ...descriptive, ...pricingFields },
      });
      ids.set(m.plaidSecurityId, existing.id);
    } else {
      const created = await prisma.security.create({
        data: {
          plaidSecurityId: m.plaidSecurityId,
          ...descriptive,
          priceSymbol: m.priceSymbol,
          pricing: m.pricing,
          fixedPrice: m.fixedPrice,
        },
      });
      ids.set(m.plaidSecurityId, created.id);
    }
  }
  return ids;
}

/** Resolve security ids the response did not list (e.g. a position sold long ago) from the DB. */
async function resolveMissingSecurities(
  plaidIds: Array<string | null>,
  securityIds: Map<string, string>
): Promise<void> {
  const missing = [...new Set(plaidIds.filter((x): x is string => !!x && !securityIds.has(x)))];
  if (!missing.length) return;
  const found = await prisma.security.findMany({ where: { plaidSecurityId: { in: missing } } });
  for (const s of found) if (s.plaidSecurityId) securityIds.set(s.plaidSecurityId, s.id);
}

async function upsertInvestmentTransactions(
  accountId: string,
  rows: MappedInvestmentTransaction[],
  securityIds: Map<string, string>
): Promise<{ upserted: number; cancelled: number }> {
  await resolveMissingSecurities(
    rows.map((r) => r.plaidSecurityId),
    securityIds
  );
  for (const r of rows) {
    const data = {
      securityId: r.plaidSecurityId ? (securityIds.get(r.plaidSecurityId) ?? null) : null,
      date: r.date,
      type: r.type,
      subtype: r.subtype,
      name: r.name,
      quantity: r.quantity,
      price: r.price,
      amount: r.amount,
      fees: r.fees,
      currency: r.currency,
      source: RecordSource.Synced,
    };
    await prisma.investmentTransaction.upsert({
      where: { accountId_externalId: { accountId, externalId: r.externalId } },
      create: { accountId, externalId: r.externalId, ...data },
      update: data,
    });
  }
  const cancelIds = rows.map((r) => r.cancelsExternalId).filter((x): x is string => !!x);
  const cancelled = cancelIds.length
    ? (
        await prisma.investmentTransaction.updateMany({
          where: { accountId, externalId: { in: cancelIds } },
          data: { isCancelled: true },
        })
      ).count
    : 0;
  return { upserted: rows.length, cancelled };
}

async function transactionWindowStart(accountId: string, today: Date): Promise<Date> {
  const latest = await prisma.investmentTransaction.findFirst({
    where: { accountId, source: RecordSource.Synced },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  return latest ? addDays(latest.date, -OVERLAP_DAYS) : addDays(today, -PLAID_TRADE_HISTORY_DAYS);
}

export async function syncPlaidInvestments(
  conn: InvestmentConnection,
  opts: { now?: Date } = {}
): Promise<InvestmentSyncResult> {
  const now = opts.now ?? new Date();
  const today = utcDay(now);
  const plaid: PlaidApi = getPlaidClient();
  const access_token = decryptAccessToken(
    conn.plaidEnrollment.accessTokenEncrypted,
    conn.plaidEnrollment.accessTokenIv
  );
  const account_ids = [conn.plaidAccountId];
  const isDepository = conn.plaidAccountType === 'depository';
  const accountId = conn.accountId;

  const result: InvestmentSyncResult = {
    accountId,
    steps: { balance: 'skipped', holdings: 'skipped', transactions: 'skipped', linking: 'skipped' },
    errors: {},
    counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
  };

  async function runStep(step: InvestmentStep, fn: () => Promise<void | 'pending'>) {
    try {
      result.steps[step] = (await fn()) ?? 'ok';
    } catch (error) {
      const { needsReauth, code, reason } = classifyPlaidError(error);
      if (needsReauth) throw error;
      result.steps[step] = code === 'PRODUCT_NOT_READY' ? 'pending' : 'error';
      result.errors[step] = reason;
      if (result.steps[step] === 'error') console.error(`[investments] ${step} failed: ${reason}`);
    }
  }

  await runStep('balance', async () => {
    const res = await plaidCall(() =>
      plaid.accountsGet({ access_token, options: { account_ids } })
    );
    const acct = res.data.accounts.find((a) => a.account_id === conn.plaidAccountId);
    if (!acct || acct.balances.current == null)
      throw new Error('Plaid returned no current balance');
    await prisma.accountBalance.upsert({
      where: { accountId_date: { accountId, date: today } },
      create: {
        accountId,
        date: today,
        balance: acct.balances.current,
        currency: conn.account.currency,
        source: BalanceRowSource.Synced,
      },
      update: { balance: acct.balances.current, source: BalanceRowSource.Synced },
    });
  });

  if (!isDepository) {
    await runStep('holdings', async () => {
      const res = await plaidCall(() =>
        plaid.investmentsHoldingsGet({ access_token, options: { account_ids } })
      );
      const holdings = res.data.holdings
        .filter((h) => h.account_id === conn.plaidAccountId)
        .map(mapHolding);
      if (!holdings.length) {
        // Empty first extraction: keep prior data and wait for the institution to report.
        const prior = await prisma.holdingSnapshot.count({
          where: { accountId, source: RecordSource.Synced },
        });
        if (!prior) {
          result.errors.holdings = 'No holdings reported yet (institution extraction pending)';
          return 'pending';
        }
      }
      const securityIds = await upsertSecurities(res.data.securities);
      await prisma.$transaction([
        prisma.holdingSnapshot.deleteMany({ where: { accountId, date: today } }),
        ...holdings
          .filter((h) => securityIds.has(h.plaidSecurityId))
          .map((h) =>
            prisma.holdingSnapshot.create({
              data: {
                accountId,
                securityId: securityIds.get(h.plaidSecurityId)!,
                date: today,
                quantity: h.quantity,
                price: h.price,
                value: h.value,
                costBasis: h.costBasis,
                source: RecordSource.Synced,
              },
            })
          ),
      ]);
      for (const h of holdings) {
        const securityId = securityIds.get(h.plaidSecurityId);
        if (!securityId) continue;
        await prisma.securityPrice.upsert({
          where: {
            securityId_date_source: { securityId, date: today, source: PriceSource.Institution },
          },
          create: { securityId, date: today, close: h.price, source: PriceSource.Institution },
          update: { close: h.price },
        });
      }
      result.counts.holdings = holdings.length;
    });
  }

  await runStep('transactions', async () => {
    const start_date = isoDay(await transactionWindowStart(accountId, today));
    const end_date = isoDay(today);
    if (isDepository) {
      const rows: MappedInvestmentTransaction[] = [];
      let total = Infinity;
      for (let offset = 0; offset < total; offset += PAGE) {
        const res = await plaidCall(() =>
          plaid.transactionsGet({
            access_token,
            start_date,
            end_date,
            options: { account_ids, count: PAGE, offset },
          })
        );
        total = res.data.total_transactions;
        for (const t of res.data.transactions) {
          const m = mapCashTransaction(t);
          if (m) rows.push(m);
        }
        if (!res.data.transactions.length) break;
      }
      const r = await upsertInvestmentTransactions(accountId, rows, new Map());
      result.counts.transactions = r.upserted;
      return;
    }
    const rows: MappedInvestmentTransaction[] = [];
    const securities: PlaidSecurity[] = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += PAGE) {
      const res = await plaidCall(() =>
        plaid.investmentsTransactionsGet({
          access_token,
          start_date,
          end_date,
          options: { account_ids, count: PAGE, offset },
        })
      );
      total = res.data.total_investment_transactions;
      securities.push(...res.data.securities);
      rows.push(...res.data.investment_transactions.map(mapInvestmentTransaction));
      if (!res.data.investment_transactions.length) break;
    }
    const securityIds = await upsertSecurities(securities);
    const r = await upsertInvestmentTransactions(accountId, rows, securityIds);
    result.counts.transactions = r.upserted;
    result.counts.cancelled = r.cancelled;
  });

  await runStep('linking', async () => {
    result.counts.linked = await linkInvestmentTransfers(prisma, [accountId]);
  });

  return result;
}
