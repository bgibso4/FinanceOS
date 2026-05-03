import { PrismaClient } from '@prisma/client';
import { endOfMonth, isAfter, isBefore, startOfMonth, subMonths } from 'date-fns';
import { FilterParams } from './types';
import { convertAmount, parseExchangeRates } from './currency';

// Helper to get exchange rates and base currency from database
async function getCurrencySettings(prisma: PrismaClient) {
  const [rates, settings] = await Promise.all([
    prisma.exchangeRate.findMany(),
    prisma.userSettings.findFirst(),
  ]);

  const rateMap = parseExchangeRates(rates);
  const baseCurrency = settings?.baseCurrency || 'USD';

  return { rateMap, baseCurrency };
}

// Helper to convert transaction amount to base currency
function convertTransactionAmount(
  amount: number,
  accountCurrency: string,
  baseCurrency: string,
  rateMap: Map<string, number>
): number {
  if (accountCurrency === baseCurrency) return amount;
  return convertAmount(amount, accountCurrency, baseCurrency, rateMap);
}

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

export function buildWhere(filters: FilterParams, startDate: Date, endDate: Date) {
  const where: any = {
    date: { gte: startDate, lte: endDate },
    isSplitParent: false,
  };
  if (filters.accounts) where.accountId = { in: filters.accounts };
  if (filters.categories) where.categoryId = { in: filters.categories };
  if (filters.merchant) where.merchant = { contains: filters.merchant, mode: 'insensitive' };
  if (filters.tags) where.tags = { array_contains: filters.tags };
  return where;
}

export async function dashboardAnalytics(
  prisma: PrismaClient,
  filters: FilterParams,
  startDate: Date,
  endDate: Date
) {
  // Get currency settings
  const { rateMap, baseCurrency } = await getCurrencySettings(prisma);

  // Get cash_flow accounts for budgeting (excludes balance_only accounts like investments)
  const cashFlowAccounts = await prisma.account.findMany({
    where: { trackingMode: 'cash_flow' },
    select: { id: true },
  });
  const cashFlowAccountIds = cashFlowAccounts.map((a) => a.id);

  // Build where clause, filtering to cash_flow accounts only
  const baseWhere = buildWhere(filters, startDate, endDate);
  const whereWithCashFlow = {
    ...baseWhere,
    isTransfer: false,
    // Only include transactions from cash_flow accounts
    // If user already filtered accounts, intersect with cash_flow accounts
    accountId: baseWhere.accountId
      ? {
          in: (baseWhere.accountId.in as string[]).filter((id: string) =>
            cashFlowAccountIds.includes(id)
          ),
        }
      : { in: cashFlowAccountIds },
  };

  let allTransactions = await prisma.transaction.findMany({
    where: whereWithCashFlow,
    select: {
      id: true,
      date: true,
      amount: true,
      merchant: true,
      isOffset: true,
      category: { select: { name: true, type: true } },
      account: { select: { currency: true } },
    },
  });

  // Filter by date string to handle timezone issues when using custom date ranges
  if (filters.startDate || filters.endDate) {
    allTransactions = allTransactions.filter((tx) => {
      const txDateStr = tx.date.toISOString().split('T')[0]; // Get YYYY-MM-DD
      if (filters.startDate && txDateStr < filters.startDate) return false;
      if (filters.endDate && txDateStr > filters.endDate) return false;
      return true;
    });
  }

  // Exclude offset transactions from calculations (they'll be applied to original purchases)
  const transactions = allTransactions.filter((tx) => !tx.isOffset);

  // Find returns that are linked to purchases in this period (even if return is outside period)
  const purchaseIds = transactions.map((tx) => tx.id);
  const linkedReturns = await prisma.transaction.findMany({
    where: {
      isOffset: true,
      linkedTransactionId: { in: purchaseIds },
    },
    select: { linkedTransactionId: true, amount: true },
  });

  // Build a map of purchase -> total return amount
  const returnAmounts = new Map<string, number>();
  linkedReturns.forEach((ret) => {
    if (ret.linkedTransactionId) {
      const current = returnAmounts.get(ret.linkedTransactionId) || 0;
      returnAmounts.set(ret.linkedTransactionId, current + Math.abs(ret.amount));
    }
  });

  // Calculate income and spending with returns applied (converted to base currency)
  let income = 0;
  let spending = 0;

  transactions.forEach((tx) => {
    const accountCurrency = tx.account?.currency || 'USD';
    const amount = Number(tx.amount);
    const returnAmount = returnAmounts.get(tx.id) || 0;

    // Convert to base currency
    const convertedAmount = convertTransactionAmount(
      amount,
      accountCurrency,
      baseCurrency,
      rateMap
    );
    const convertedReturnAmount = convertTransactionAmount(
      returnAmount,
      accountCurrency,
      baseCurrency,
      rateMap
    );

    const bucket = bucketForTransaction(amount, tx.category?.type);
    if (bucket === 'income') {
      // Signed contribution so a refunded paycheck (negative amount in income
      // category) reduces income instead of being counted as spending.
      income += convertedAmount;
    } else if (amount < 0) {
      // Negative in expense/uncategorized: counts as spending, less linked returns
      spending += Math.abs(convertedAmount) - convertedReturnAmount;
    } else {
      // Positive in expense category: a credit that reduces spending
      spending -= convertedAmount;
    }
  });

  const savings = income - spending;

  // Get previous period transactions for month-over-month comparison
  const periodLength = endDate.getTime() - startDate.getTime();
  const prevStart = new Date(startDate.getTime() - periodLength);
  const prevEnd = new Date(startDate.getTime() - 1);

  // Build where clause for previous period, also filtering to cash_flow accounts
  const prevBaseWhere = buildWhere(filters, prevStart, prevEnd);
  const prevWhereWithCashFlow = {
    ...prevBaseWhere,
    isTransfer: false,
    accountId: prevBaseWhere.accountId
      ? {
          in: (prevBaseWhere.accountId.in as string[]).filter((id: string) =>
            cashFlowAccountIds.includes(id)
          ),
        }
      : { in: cashFlowAccountIds },
  };

  let allPrevTransactions = await prisma.transaction.findMany({
    where: prevWhereWithCashFlow,
    select: {
      id: true,
      date: true,
      amount: true,
      merchant: true,
      isOffset: true,
      category: { select: { name: true, type: true } },
      account: { select: { currency: true } },
    },
  });

  // Filter previous period by date string too
  if (filters.startDate || filters.endDate) {
    const prevStartStr = prevStart.toISOString().split('T')[0];
    const prevEndStr = prevEnd.toISOString().split('T')[0];
    allPrevTransactions = allPrevTransactions.filter((tx) => {
      const txDateStr = tx.date.toISOString().split('T')[0];
      if (txDateStr < prevStartStr) return false;
      if (txDateStr > prevEndStr) return false;
      return true;
    });
  }

  const prevTransactions = allPrevTransactions.filter((tx) => !tx.isOffset);

  // Get returns for previous period
  const prevPurchaseIds = prevTransactions.map((tx) => tx.id);
  const prevLinkedReturns = await prisma.transaction.findMany({
    where: {
      isOffset: true,
      linkedTransactionId: { in: prevPurchaseIds },
    },
    select: { linkedTransactionId: true, amount: true },
  });

  const prevReturnAmounts = new Map<string, number>();
  prevLinkedReturns.forEach((ret) => {
    if (ret.linkedTransactionId) {
      const current = prevReturnAmounts.get(ret.linkedTransactionId) || 0;
      prevReturnAmounts.set(ret.linkedTransactionId, current + Math.abs(ret.amount));
    }
  });

  let prevIncome = 0;
  let prevSpending = 0;

  prevTransactions.forEach((tx) => {
    const accountCurrency = tx.account?.currency || 'USD';
    const amount = Number(tx.amount);
    const returnAmount = prevReturnAmounts.get(tx.id) || 0;

    // Convert to base currency
    const convertedAmount = convertTransactionAmount(
      amount,
      accountCurrency,
      baseCurrency,
      rateMap
    );
    const convertedReturnAmount = convertTransactionAmount(
      returnAmount,
      accountCurrency,
      baseCurrency,
      rateMap
    );

    const bucket = bucketForTransaction(amount, tx.category?.type);
    if (bucket === 'income') {
      prevIncome += convertedAmount;
    } else if (amount < 0) {
      prevSpending += Math.abs(convertedAmount) - convertedReturnAmount;
    } else {
      prevSpending -= convertedAmount;
    }
  });

  const categoryTotals: Record<
    string,
    { amount: number; type: string | null; txCount: number; returnAmount: number }
  > = {};
  for (const tx of transactions) {
    const txAmount = Number(tx.amount);
    const categoryType = tx.category?.type ?? null;

    // Uncategorized positives are routed to income (per bucketForTransaction),
    // so they should not reduce the Uncategorized spending line.
    if (categoryType === null && txAmount >= 0) continue;

    const key = tx.category?.name ?? 'Uncategorized';
    const accountCurrency = tx.account?.currency || 'USD';
    const returnAmount = returnAmounts.get(tx.id) || 0;

    categoryTotals[key] = categoryTotals[key] ?? {
      amount: 0,
      type: categoryType,
      txCount: 0,
      returnAmount: 0,
    };

    // Add all transactions (positive and negative) to get net amount per category
    const convertedAmount = convertTransactionAmount(
      txAmount,
      accountCurrency,
      baseCurrency,
      rateMap
    );
    const convertedReturnAmount = convertTransactionAmount(
      returnAmount,
      accountCurrency,
      baseCurrency,
      rateMap
    );

    if (txAmount < 0) {
      // For expenses, subtract any returns
      categoryTotals[key].amount += Math.abs(convertedAmount) - convertedReturnAmount;
      categoryTotals[key].returnAmount += convertedReturnAmount;
    } else {
      // Positive in an expense or income category — net against the category total
      // (e.g., a roommate Zelle on the Rent line reduces rent spending).
      categoryTotals[key].amount -= convertedAmount;
    }

    categoryTotals[key].txCount += 1;
  }

  // Previous period category totals for comparison (with returns applied and converted)
  const prevCategoryTotals: Record<string, number> = {};
  for (const tx of prevTransactions) {
    const amount = Number(tx.amount);
    const categoryType = tx.category?.type ?? null;

    // Mirror current-period logic: skip uncategorized positives so they don't
    // reduce the Uncategorized spending baseline used for month-over-month.
    if (categoryType === null && amount >= 0) continue;

    const key = tx.category?.name ?? 'Uncategorized';
    const accountCurrency = tx.account?.currency || 'USD';
    const returnAmount = prevReturnAmounts.get(tx.id) || 0;

    prevCategoryTotals[key] = prevCategoryTotals[key] ?? 0;

    if (amount < 0) {
      // For expenses, subtract any returns
      const netAmount = Math.abs(amount) - returnAmount;
      const convertedNetAmount = convertTransactionAmount(
        netAmount,
        accountCurrency,
        baseCurrency,
        rateMap
      );
      prevCategoryTotals[key] += convertedNetAmount;
    } else {
      // For income/credits, subtract from the category total
      const convertedAmount = convertTransactionAmount(
        amount,
        accountCurrency,
        baseCurrency,
        rateMap
      );
      prevCategoryTotals[key] -= convertedAmount;
    }
  }

  const spendByCategory = Object.entries(categoryTotals)
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
    const convertedAmount = convertTransactionAmount(
      Math.abs(Number(tx.amount)),
      accountCurrency,
      baseCurrency,
      rateMap
    );
    merchantTotals[tx.merchant] = (merchantTotals[tx.merchant] ?? 0) + convertedAmount;
  }

  for (const tx of prevTransactions) {
    if (Number(tx.amount) >= 0) continue;
    const accountCurrency = tx.account?.currency || 'USD';
    const convertedAmount = convertTransactionAmount(
      Math.abs(Number(tx.amount)),
      accountCurrency,
      baseCurrency,
      rateMap
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
    // Use UTC date string to avoid timezone conversion
    const month = tx.date.toISOString().split('T')[0].substring(0, 7); // Get YYYY-MM
    monthBuckets[month] = monthBuckets[month] ?? { income: 0, spending: 0 };

    const accountCurrency = tx.account?.currency || 'USD';
    const amount = Number(tx.amount);
    const returnAmount = returnAmounts.get(tx.id) || 0;
    const convertedAmount = convertTransactionAmount(
      amount,
      accountCurrency,
      baseCurrency,
      rateMap
    );
    const bucket = bucketForTransaction(amount, tx.category?.type);

    if (bucket === 'income') {
      monthBuckets[month].income += convertedAmount;
    } else if (amount < 0) {
      // Apply returns to reduce spending (converted)
      const netSpending = Math.abs(amount) - returnAmount;
      const convertedNetSpending = convertTransactionAmount(
        netSpending,
        accountCurrency,
        baseCurrency,
        rateMap
      );
      monthBuckets[month].spending += convertedNetSpending;
    } else {
      // Positive in an expense category — reduces that month's spending
      monthBuckets[month].spending -= convertedAmount;
    }
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
    const windowStart = startOfMonth(subMonths(endDate, i));
    const windowEnd = endOfMonth(windowStart);
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
  const start = new Date(year, m - 1, 1);
  const end = endOfMonth(start);

  // Get cash_flow accounts for budgeting (excludes balance_only accounts like investments)
  const cashFlowAccounts = await prisma.account.findMany({
    where: { trackingMode: 'cash_flow' },
    select: { id: true },
  });
  const cashFlowAccountIds = cashFlowAccounts.map((a) => a.id);

  const transactions = await prisma.transaction.findMany({
    where: {
      date: { gte: start, lte: end },
      isTransfer: false,
      isSplitParent: false,
      accountId: { in: cashFlowAccountIds },
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
