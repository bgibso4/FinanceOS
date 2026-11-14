import { PrismaClient } from '@prisma/client';
import { isAfter, isBefore } from 'date-fns';
import { utcMonthRange } from './dates';
import { FilterParams } from './types';
import { filterWhere, matchesTags } from './transaction-filters';
import { parseTags } from './transaction-rows';
import { loadCurrencySettings, toBase, type CurrencySettings } from './currency';

/**
 * Decide whether a transaction belongs to the income or spending totals.
 *
 * Category type drives the bucket when set, so a positive amount categorized
 * as Rent (a roommate reimbursement, refund, cashback, etc.) reduces rent
 * spending rather than appearing as a separate income line. For uncategorized
 * transactions, we fall back to sign so that an unsorted paycheck still feels
 * like income on the dashboard until the user categorizes it.
 */
function bucketForTransaction(
  amount: number,
  categoryType: string | null | undefined
): 'income' | 'spending' {
  if (categoryType === 'income') return 'income';
  if (categoryType === 'expense') return 'spending';
  return amount >= 0 ? 'income' : 'spending';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildWhere(filters: FilterParams, startDate: Date, endDate: Date): any {
  return {
    date: { gte: startDate, lte: endDate },
    isSplitParent: false,
    ...filterWhere(filters),
  };
}

/**
 * A window's countable rows: cash-flow accounts, no transfers, split parents or offsets,
 * matching the filters. Offsets are not counted themselves; `returnAmounts` holds, per
 * purchase, the total of its linked returns, wherever in time those returns fall.
 */
async function loadPeriodTransactions(
  prisma: PrismaClient,
  filters: FilterParams,
  startDate: Date,
  endDate: Date,
  cashFlowIds: string[]
) {
  const baseWhere = buildWhere(filters, startDate, endDate);
  const rows = await prisma.transaction.findMany({
    where: {
      ...baseWhere,
      isTransfer: false,
      // Intersect any account filter with the cash-flow accounts
      accountId: {
        in: baseWhere.accountId
          ? (baseWhere.accountId.in as string[]).filter((id) => cashFlowIds.includes(id))
          : cashFlowIds,
      },
    },
    select: {
      id: true,
      date: true,
      amount: true,
      merchant: true,
      isOffset: true,
      tags: true,
      categoryId: true,
      category: { select: { name: true, type: true } },
      account: { select: { currency: true } },
    },
  });

  const transactions = rows.filter(
    (tx) =>
      !tx.isOffset &&
      // Tags are a JSON string column, so they are matched here rather than in SQL
      matchesTags(tx.tags, filters.tags) &&
      withinDays(dayOf(tx.date), filters.startDate, filters.endDate)
  );

  const linkedReturns = await prisma.transaction.findMany({
    where: { isOffset: true, linkedTransactionId: { in: transactions.map((tx) => tx.id) } },
    select: { linkedTransactionId: true, amount: true },
  });
  const returnAmounts = new Map<string, number>();
  for (const ret of linkedReturns) {
    if (!ret.linkedTransactionId) continue;
    const current = returnAmounts.get(ret.linkedTransactionId) || 0;
    returnAmounts.set(ret.linkedTransactionId, current + Math.abs(ret.amount));
  }

  return { transactions, returnAmounts };
}

/** A stored transaction date as its calendar day, `YYYY-MM-DD`. */
const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

const withinDays = (day: string, from?: string, to?: string) =>
  (!from || day >= from) && (!to || day <= to);

/** The filters for a window other than the one their day strings name. */
const withoutDays = (f: FilterParams): FilterParams => ({
  ...f,
  startDate: undefined,
  endDate: undefined,
});

/**
 * What a row adds to a category's net spend, in base currency: a purchase less its
 * linked returns, or a credit (positive amount) taken off.
 */
function netSpend(
  amount: number,
  returnAmount: number,
  currency: string,
  day: string,
  s: CurrencySettings
) {
  return amount < 0
    ? Math.abs(toBase(amount, currency, s, day)) - toBase(returnAmount, currency, s, day)
    : -toBase(amount, currency, s, day);
}

/** What a row adds to spending, in base currency; null when it belongs to income. */
function spendOf(
  amount: number,
  categoryType: string | null | undefined,
  returnAmount: number,
  currency: string,
  day: string,
  s: CurrencySettings
): number | null {
  if (bucketForTransaction(amount, categoryType) === 'income') return null;
  return netSpend(amount, returnAmount, currency, day, s);
}

type PeriodTransaction = Awaited<ReturnType<typeof loadPeriodTransactions>>['transactions'][number];

const currencyOf = (tx: PeriodTransaction) => tx.account?.currency || 'USD';

/** Income and spending totals for a window, in base currency. */
function totalsOf(
  transactions: PeriodTransaction[],
  returnAmounts: Map<string, number>,
  s: CurrencySettings
) {
  let income = 0;
  let spending = 0;
  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const spend = spendOf(
      amount,
      tx.category?.type,
      returnAmounts.get(tx.id) || 0,
      currencyOf(tx),
      dayOf(tx.date),
      s
    );
    // Income is signed, so a refunded paycheck reduces income rather than adding spend
    if (spend === null) income += toBase(amount, currencyOf(tx), s, dayOf(tx.date));
    else spending += spend;
  }
  return { income, spending };
}

/** Net spend per category name; uncategorized credits count as income, so are left out. */
function categoryTotalsOf(
  transactions: PeriodTransaction[],
  returnAmounts: Map<string, number>,
  s: CurrencySettings
) {
  const totals: Record<
    string,
    { amount: number; type: string | null; txCount: number; returnAmount: number }
  > = {};
  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const type = tx.category?.type ?? null;
    if (type === null && amount >= 0) continue;
    const key = tx.category?.name ?? 'Uncategorized';
    const returnAmount = returnAmounts.get(tx.id) || 0;
    const entry = (totals[key] ??= { amount: 0, type, txCount: 0, returnAmount: 0 });
    entry.amount += netSpend(amount, returnAmount, currencyOf(tx), dayOf(tx.date), s);
    if (amount < 0) entry.returnAmount += toBase(returnAmount, currencyOf(tx), s, dayOf(tx.date));
    entry.txCount += 1;
  }
  return totals;
}

async function cashFlowAccountIds(prisma: PrismaClient) {
  // balance_only accounts (investments and the like) are not cash flow
  const accounts = await prisma.account.findMany({
    where: { trackingMode: 'cash_flow' },
    select: { id: true },
  });
  return accounts.map((a) => a.id);
}

export type DateRange = { startDate: Date; endDate: Date };

/** One day's net spend in one category (null = uncategorized), in base currency. */
export type DaySpend = { date: string; categoryId: string | null; amount: number };

/** Net spend per day and category over a window; income is left out. */
export async function spendingByDay(
  prisma: PrismaClient,
  filters: FilterParams,
  startDate: Date,
  endDate: Date
): Promise<DaySpend[]> {
  const [s, cashFlowIds] = await Promise.all([
    loadCurrencySettings(prisma),
    cashFlowAccountIds(prisma),
  ]);
  const { transactions, returnAmounts } = await loadPeriodTransactions(
    prisma,
    withoutDays(filters),
    startDate,
    endDate,
    cashFlowIds
  );

  const days = new Map<string, DaySpend>();
  for (const tx of transactions) {
    const spend = spendOf(
      Number(tx.amount),
      tx.category?.type,
      returnAmounts.get(tx.id) || 0,
      currencyOf(tx),
      dayOf(tx.date),
      s
    );
    if (spend === null) continue;
    const date = dayOf(tx.date);
    const key = `${date}|${tx.categoryId ?? ''}`;
    const row = days.get(key) ?? { date, categoryId: tx.categoryId, amount: 0 };
    row.amount += spend;
    days.set(key, row);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type TagSpend = { total: number; firstDate: string | null; lastDate: string | null };

/** All-time net spend per tag name, with the first and last day it was counted. */
export async function spendingByTag(prisma: PrismaClient): Promise<Map<string, TagSpend>> {
  const [s, cashFlowIds] = await Promise.all([
    loadCurrencySettings(prisma),
    cashFlowAccountIds(prisma),
  ]);
  const { transactions, returnAmounts } = await loadPeriodTransactions(
    prisma,
    {},
    new Date(0),
    new Date(Date.UTC(9999, 0, 1)),
    cashFlowIds
  );

  const byTag = new Map<string, TagSpend>();
  for (const tx of transactions) {
    if (!tx.tags) continue;
    const date = dayOf(tx.date);
    const spend = spendOf(
      Number(tx.amount),
      tx.category?.type,
      returnAmounts.get(tx.id) || 0,
      currencyOf(tx),
      date,
      s
    );
    if (spend === null) continue;
    for (const name of new Set(parseTags(tx.tags))) {
      const row = byTag.get(name) ?? { total: 0, firstDate: null, lastDate: null };
      row.total += spend;
      if (row.firstDate === null || date < row.firstDate) row.firstDate = date;
      if (row.lastDate === null || date > row.lastDate) row.lastDate = date;
      byTag.set(name, row);
    }
  }
  for (const row of byTag.values()) row.total = Math.round(row.total * 100) / 100 || 0;
  return byTag;
}

/**
 * The analytics for a period. The comparison is `compare` when given, otherwise the
 * window of the same length just before the period.
 */
export async function dashboardAnalytics(
  prisma: PrismaClient,
  filters: FilterParams,
  startDate: Date,
  endDate: Date,
  compare?: DateRange
) {
  const currencySettings = await loadCurrencySettings(prisma);
  const cashFlowIds = await cashFlowAccountIds(prisma);

  const { transactions, returnAmounts } = await loadPeriodTransactions(
    prisma,
    filters,
    startDate,
    endDate,
    cashFlowIds
  );
  const { income, spending } = totalsOf(transactions, returnAmounts, currencySettings);
  const savings = income - spending;

  // The filters' day strings name the current period, so they are dropped for the comparison
  const periodLength = endDate.getTime() - startDate.getTime();
  const prev = compare ?? {
    startDate: new Date(startDate.getTime() - periodLength),
    endDate: new Date(startDate.getTime() - 1),
  };
  const { transactions: prevTransactions, returnAmounts: prevReturnAmounts } =
    await loadPeriodTransactions(
      prisma,
      withoutDays(filters),
      prev.startDate,
      prev.endDate,
      cashFlowIds
    );
  const { income: prevIncome, spending: prevSpending } = totalsOf(
    prevTransactions,
    prevReturnAmounts,
    currencySettings
  );

  const categoryTotals = categoryTotalsOf(transactions, returnAmounts, currencySettings);
  const prevTotals = categoryTotalsOf(prevTransactions, prevReturnAmounts, currencySettings);
  const prevCategoryTotals: Record<string, number> = {};
  for (const [name, meta] of Object.entries(prevTotals)) {
    prevCategoryTotals[name] = meta.amount;
  }

  // With an explicit comparison (Analytics), categories spent in only that period are listed
  // too, at zero now. Without one, home, Reports and trailing-12 keep today's list.
  const listedTotals = compare
    ? {
        ...Object.fromEntries(
          Object.entries(prevTotals).map(([name, meta]) => [
            name,
            { ...meta, amount: 0, txCount: 0, returnAmount: 0 },
          ])
        ),
        ...categoryTotals,
      }
    : categoryTotals;

  const spendByCategory = Object.entries(listedTotals)
    .filter(([, meta]) => (meta.type ?? 'expense') !== 'income')
    .map(([category, meta]) => {
      const prevAmount = prevCategoryTotals[category] ?? 0;
      const currentAmount = meta.amount;
      const monthOverMonth = prevAmount > 0 ? ((currentAmount - prevAmount) / prevAmount) * 100 : 0;
      const isOutlier = Math.abs(monthOverMonth) > 50; // Flag if >50% change
      return {
        category,
        amount: currentAmount,
        returnAmount: meta.returnAmount,
        monthOverMonth,
        isOutlier,
        txCount: meta.txCount,
        prevAmount,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // All categories including income (for reports)
  const allCategories = Object.entries(categoryTotals)
    .map(([category, meta]) => {
      const prevAmount = prevCategoryTotals[category] ?? 0;
      const currentAmount = meta.amount;
      const monthOverMonth = prevAmount > 0 ? ((currentAmount - prevAmount) / prevAmount) * 100 : 0;
      const isOutlier = Math.abs(monthOverMonth) > 50;
      return {
        category,
        amount: currentAmount,
        returnAmount: meta.returnAmount,
        monthOverMonth,
        isOutlier,
        txCount: meta.txCount,
        prevAmount,
      };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  // Removed .slice(0, 10) to show all categories

  const merchantTotals: Record<string, number> = {};
  const prevMerchantTotals: Record<string, number> = {};

  for (const tx of transactions) {
    if (Number(tx.amount) >= 0) continue;
    const accountCurrency = tx.account?.currency || 'USD';
    const convertedAmount = toBase(
      Math.abs(Number(tx.amount)),
      accountCurrency,
      currencySettings,
      dayOf(tx.date)
    );
    merchantTotals[tx.merchant] = (merchantTotals[tx.merchant] ?? 0) + convertedAmount;
  }

  for (const tx of prevTransactions) {
    if (Number(tx.amount) >= 0) continue;
    const accountCurrency = tx.account?.currency || 'USD';
    const convertedAmount = toBase(
      Math.abs(Number(tx.amount)),
      accountCurrency,
      currencySettings,
      dayOf(tx.date)
    );
    prevMerchantTotals[tx.merchant] = (prevMerchantTotals[tx.merchant] ?? 0) + convertedAmount;
  }

  const topMerchants = Object.entries(merchantTotals)
    .map(([merchant, amount]) => {
      const prevAmount = prevMerchantTotals[merchant] ?? 0;
      const change = prevAmount > 0 ? ((amount - prevAmount) / prevAmount) * 100 : 0;
      return { merchant, amount, change, prevAmount };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const monthBuckets: Record<string, { income: number; spending: number }> = {};
  for (const tx of transactions) {
    const month = dayOf(tx.date).slice(0, 7);
    const bucket = (monthBuckets[month] ??= { income: 0, spending: 0 });
    const amount = Number(tx.amount);
    const spend = spendOf(
      amount,
      tx.category?.type,
      returnAmounts.get(tx.id) || 0,
      currencyOf(tx),
      dayOf(tx.date),
      currencySettings
    );
    if (spend === null)
      bucket.income += toBase(amount, currencyOf(tx), currencySettings, dayOf(tx.date));
    else bucket.spending += spend;
  }
  const incomeVsSpending = Object.entries(monthBuckets)
    .filter(([, data]) => data.income > 0 || data.spending > 0) // Only show months with activity
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([month, data]) => ({ month, income: data.income, spending: data.spending }));

  const savingsRate = income > 0 ? savings / income : 0;

  // Calculate savings rate delta using the already-fetched previous period data
  const prevSavings = prevIncome + prevSpending;
  const prevRate = prevIncome > 0 ? prevSavings / prevIncome : 0;
  const delta = savingsRate - prevRate;

  const rollingWindow: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { start: windowStart, end: windowEnd } = utcMonthRange(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth() - i
    );
    const windowTx = transactions.filter(
      (tx) => !isBefore(tx.date, windowStart) && !isAfter(tx.date, windowEnd)
    );
    const windowIncome = windowTx
      .filter((tx) => Number(tx.amount) > 0)
      .reduce((acc, tx) => acc + Number(tx.amount), 0);
    const windowSpending = windowTx
      .filter((tx) => Number(tx.amount) < 0)
      .reduce((acc, tx) => acc + Number(tx.amount), 0);
    rollingWindow.push(windowIncome > 0 ? (windowIncome + windowSpending) / windowIncome : 0);
  }
  const rollingAvg = rollingWindow.length
    ? rollingWindow.reduce((a, b) => a + b, 0) / rollingWindow.length
    : 0;

  const trendAlerts = buildTrendAlerts(categoryTotals, prevTransactions);

  return {
    netCashflow: {
      income,
      spending: Math.abs(spending),
      savings,
      prevIncome,
      prevSpending: Math.abs(prevSpending),
      prevSavings: prevIncome + prevSpending,
    },
    savingsRate: { rate: savingsRate, delta, rollingAvg },
    spendByCategory,
    allCategories, // Include all categories including income
    topMerchants,
    incomeVsSpending,
    trendAlerts,
    transactionCount: transactions.length,
    prevTransactionCount: prevTransactions.length,
  };
}

function buildTrendAlerts(
  currentCategoryTotals: Record<string, { amount: number; type: string | null; txCount: number }>,
  previousTx: { amount: any; category?: { name: string } | null }[]
) {
  const prevTotals: Record<string, number> = {};
  previousTx.forEach((tx) => {
    const category = tx.category?.name ?? 'Uncategorized';
    prevTotals[category] = (prevTotals[category] ?? 0) + Number(tx.amount);
  });

  const alerts = Object.entries(currentCategoryTotals).map(([category, meta]) => {
    const prev = prevTotals[category] ?? 0;
    const deltaAmount = meta.amount - prev;
    const deltaPct = prev !== 0 ? deltaAmount / prev : 1;
    return {
      title: `${category} change`,
      description: `${category} moved by ${deltaAmount.toFixed(2)}`,
      deltaAmount,
      deltaPct,
    };
  });

  return alerts.sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount)).slice(0, 5);
}

export async function monthlySnapshot(prisma: PrismaClient, month: string) {
  const [year, m] = month.split('-').map((n) => parseInt(n, 10));
  const { start, end } = utcMonthRange(year, m - 1);

  const cashFlowIds = await cashFlowAccountIds(prisma);

  const transactions = await prisma.transaction.findMany({
    where: {
      date: { gte: start, lte: end },
      isTransfer: false,
      isSplitParent: false,
      accountId: { in: cashFlowIds },
    },
    select: {
      amount: true,
      merchant: true,
      category: { select: { name: true, type: true } },
    },
  });

  let income = 0;
  let spending = 0;
  for (const tx of transactions) {
    const amount = Number(tx.amount);
    const bucket = bucketForTransaction(amount, tx.category?.type);
    if (bucket === 'income') {
      income += amount;
    } else {
      // Spending kept as a negative number to preserve `savings = income + spending`
      spending += amount < 0 ? amount : -amount;
    }
  }
  const savings = income + spending;
  const savingsRatePct = income > 0 ? (savings / income) * 100 : 0;

  const categoryTotals: Record<string, number> = {};
  const merchantTotals: Record<string, number> = {};
  for (const tx of transactions) {
    const category = tx.category?.name ?? 'Uncategorized';
    categoryTotals[category] = (categoryTotals[category] ?? 0) + Number(tx.amount);
    merchantTotals[tx.merchant] = (merchantTotals[tx.merchant] ?? 0) + Number(tx.amount);
  }

  return {
    incomeTotal: income,
    spendingTotal: Math.abs(spending),
    savingsTotal: savings,
    savingsRatePct,
    categoryTotals,
    merchantTotals,
  };
}

export async function ensureSnapshot(prisma: PrismaClient, month: string) {
  const existing = await prisma.monthlySnapshot.findFirst({ where: { month } });
  if (existing) return existing;
  const calc = await monthlySnapshot(prisma, month);
  return prisma.monthlySnapshot.create({
    data: {
      month,
      incomeTotal: calc.incomeTotal,
      spendingTotal: calc.spendingTotal,
      savingsTotal: calc.savingsTotal,
      savingsRatePct: calc.savingsRatePct,
      categoryTotals: JSON.stringify(calc.categoryTotals),
      merchantTotals: JSON.stringify(calc.merchantTotals),
    },
  });
}

export function paceForecast(spent: number, limit: number, startDate: Date, endDate: Date) {
  const today = new Date();
  const elapsedDays = Math.max(1, (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const totalDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const pace = spent / elapsedDays;
  const forecast = pace * totalDays;

  let status: 'on-track' | 'trending-over' | 'over' = 'on-track';
  if (forecast > limit * 1.05) status = 'trending-over';
  if (spent > limit) status = 'over';
  return { forecast, status };
}
