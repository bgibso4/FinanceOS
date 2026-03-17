import { z } from 'zod';
import { tool } from 'ai';
import { subMonths } from 'date-fns';
import type { PrismaClient } from '@prisma/client';
import type { ChartSpec } from '@/lib/types';

// ---------------------------------------------------------------------------
// 1. executeGetCategories
// ---------------------------------------------------------------------------

export async function executeGetCategories(
  prisma: PrismaClient
): Promise<{ name: string; type: string; parentName: string | null }[]> {
  const categories = await prisma.category.findMany({
    select: {
      name: true,
      type: true,
      parent: { select: { name: true } },
    },
  });

  return categories.map((c) => ({
    name: c.name,
    type: c.type,
    parentName: c.parent?.name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 2. executeQueryTransactions
// ---------------------------------------------------------------------------

type QueryTransactionsParams = {
  startDate: string;
  endDate: string;
  category?: string;
  merchant?: string;
  tag?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
};

export async function executeQueryTransactions(
  prisma: PrismaClient,
  params: QueryTransactionsParams
): Promise<{
  transactions: {
    date: string;
    amount: number;
    merchant: string;
    category: string | null;
    account: string;
    note: string | null;
    tags: string[];
  }[];
  total: number;
}> {
  const where: any = {
    date: {
      gte: new Date(params.startDate),
      lte: new Date(params.endDate + 'T23:59:59.999Z'),
    },
    isSplitParent: false,
  };

  if (params.category) {
    where.category = { name: params.category };
  }
  if (params.merchant) {
    where.merchantNormalized = { contains: params.merchant.toLowerCase() };
  }
  if (params.tag) {
    where.tags = { contains: params.tag };
  }
  if (params.minAmount !== undefined || params.maxAmount !== undefined) {
    where.amount = {};
    if (params.minAmount !== undefined) where.amount.gte = params.minAmount;
    if (params.maxAmount !== undefined) where.amount.lte = params.maxAmount;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    select: {
      date: true,
      amount: true,
      merchant: true,
      note: true,
      tags: true,
      category: { select: { name: true } },
      account: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
    take: params.limit ?? 100,
  });

  const sanitized = transactions.map((t) => ({
    date: t.date.toISOString().split('T')[0],
    amount: t.amount,
    merchant: t.merchant,
    category: t.category?.name ?? null,
    account: t.account.name,
    note: t.note ?? null,
    tags: parseTags(t.tags),
  }));

  return { transactions: sanitized, total: sanitized.length };
}

// ---------------------------------------------------------------------------
// 3. executeGetAccountBalances
// ---------------------------------------------------------------------------

export async function executeGetAccountBalances(
  prisma: PrismaClient
): Promise<
  { name: string; type: string; institution: string | null; currency: string; balance: number }[]
> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: {
      name: true,
      type: true,
      institution: true,
      currency: true,
      transactions: {
        select: { amount: true },
      },
    },
  });

  return accounts.map((a) => ({
    name: a.name,
    type: a.type,
    institution: a.institution,
    currency: a.currency,
    balance: a.transactions.reduce((sum, t) => sum + t.amount, 0),
  }));
}

// ---------------------------------------------------------------------------
// 4. executeGetCategoryBreakdown
// ---------------------------------------------------------------------------

type DateRangeParams = {
  startDate: string;
  endDate: string;
};

export async function executeGetCategoryBreakdown(
  prisma: PrismaClient,
  params: DateRangeParams
): Promise<{ category: string; group: string | null; amount: number; count: number }[]> {
  const transactions = await prisma.transaction.findMany({
    where: {
      date: {
        gte: new Date(params.startDate),
        lte: new Date(params.endDate + 'T23:59:59.999Z'),
      },
      amount: { lt: 0 },
      isTransfer: false,
      isSplitParent: false,
    },
    select: {
      amount: true,
      category: {
        select: {
          name: true,
          parent: { select: { name: true } },
        },
      },
    },
  });

  const breakdown: Record<string, { group: string | null; amount: number; count: number }> = {};

  for (const t of transactions) {
    const catName = t.category?.name ?? 'Uncategorized';
    const groupName = t.category?.parent?.name ?? null;

    if (!breakdown[catName]) {
      breakdown[catName] = { group: groupName, amount: 0, count: 0 };
    }
    breakdown[catName].amount += Math.abs(t.amount);
    breakdown[catName].count += 1;
  }

  return Object.entries(breakdown)
    .map(([category, data]) => ({
      category,
      group: data.group,
      amount: data.amount,
      count: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// 5. executeGetMerchantBreakdown
// ---------------------------------------------------------------------------

export async function executeGetMerchantBreakdown(
  prisma: PrismaClient,
  params: DateRangeParams
): Promise<{ merchant: string; amount: number; count: number }[]> {
  const transactions = await prisma.transaction.findMany({
    where: {
      date: {
        gte: new Date(params.startDate),
        lte: new Date(params.endDate + 'T23:59:59.999Z'),
      },
      amount: { lt: 0 },
      isTransfer: false,
      isSplitParent: false,
    },
    select: {
      amount: true,
      merchant: true,
    },
  });

  const breakdown: Record<string, { amount: number; count: number }> = {};

  for (const t of transactions) {
    const key = t.merchant;
    if (!breakdown[key]) {
      breakdown[key] = { amount: 0, count: 0 };
    }
    breakdown[key].amount += Math.abs(t.amount);
    breakdown[key].count += 1;
  }

  return Object.entries(breakdown)
    .map(([merchant, data]) => ({
      merchant,
      amount: data.amount,
      count: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// 6. executeGetBudgetStatus
// ---------------------------------------------------------------------------

type BudgetStatusParams = {
  month: string; // YYYY-MM
};

export async function executeGetBudgetStatus(
  prisma: PrismaClient,
  params: BudgetStatusParams
): Promise<
  { category: string; budgeted: number; actual: number; remaining: number; percentUsed: number }[]
> {
  const budgets = await prisma.categoryBudget.findMany({
    where: { month: params.month },
    select: {
      limitAmount: true,
      category: {
        select: { name: true },
      },
    },
  });

  // Parse month to get UTC date range
  const [year, month] = params.month.split('-').map(Number);
  const monthStart = new Date(`${params.month}-01T00:00:00.000Z`);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(nextMonth.getTime() - 1);

  const results = await Promise.all(
    budgets.map(async (b) => {
      const transactions = await prisma.transaction.findMany({
        where: {
          date: { gte: monthStart, lte: monthEnd },
          amount: { lt: 0 },
          category: { name: b.category.name },
          isTransfer: false,
          isSplitParent: false,
        },
        select: { amount: true },
      });

      const actual = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

      return {
        category: b.category.name,
        budgeted: b.limitAmount,
        actual,
        remaining: b.limitAmount - actual,
        percentUsed: b.limitAmount > 0 ? (actual / b.limitAmount) * 100 : 0,
      };
    })
  );

  return results;
}

// ---------------------------------------------------------------------------
// 7. executeGetMonthlyTrend
// ---------------------------------------------------------------------------

type MonthlyTrendParams = {
  months: number;
};

export async function executeGetMonthlyTrend(
  prisma: PrismaClient,
  params: MonthlyTrendParams
): Promise<{ month: string; income: number; spending: number; net: number }[]> {
  const now = new Date();
  const results: { month: string; income: number; spending: number; net: number }[] = [];

  // Iterate from (months-1) months ago to current month
  for (let i = params.months - 1; i >= 0; i--) {
    const targetDate = subMonths(now, i);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth(); // 0-indexed
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Use UTC dates to match how transaction dates are stored
    const monthStart = new Date(`${monthStr}-01T00:00:00.000Z`);
    // Last day of the month at end of day in UTC
    const nextMonth = new Date(Date.UTC(year, month + 1, 1));
    const monthEnd = new Date(nextMonth.getTime() - 1);

    const transactions = await prisma.transaction.findMany({
      where: {
        date: { gte: monthStart, lte: monthEnd },
        isTransfer: false,
        isSplitParent: false,
      },
      select: { amount: true },
    });

    let income = 0;
    let spending = 0;

    for (const t of transactions) {
      if (t.amount > 0) {
        income += t.amount;
      } else {
        spending += Math.abs(t.amount);
      }
    }

    results.push({
      month: monthStr,
      income,
      spending,
      net: income - spending,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 8. executeGetCashFlow
// ---------------------------------------------------------------------------

export async function executeGetCashFlow(
  prisma: PrismaClient,
  params: DateRangeParams
): Promise<{ income: number; expenses: number; net: number }> {
  const transactions = await prisma.transaction.findMany({
    where: {
      date: {
        gte: new Date(params.startDate),
        lte: new Date(params.endDate + 'T23:59:59.999Z'),
      },
      isTransfer: false,
      isSplitParent: false,
    },
    select: { amount: true },
  });

  let income = 0;
  let expenses = 0;

  for (const t of transactions) {
    if (t.amount > 0) {
      income += t.amount;
    } else {
      expenses += Math.abs(t.amount);
    }
  }

  return {
    income,
    expenses,
    net: income - expenses,
  };
}

// ---------------------------------------------------------------------------
// 9. executeGetRecurringTransactions
// ---------------------------------------------------------------------------

type RecurringParams = {
  status?: string;
};

export async function executeGetRecurringTransactions(
  prisma: PrismaClient,
  params: RecurringParams
): Promise<
  {
    merchant: string;
    amount: number;
    frequency: string;
    status: string;
    category: string | null;
    nextExpectedDate: string | null;
  }[]
> {
  const where: any = {};
  if (params.status) {
    where.status = params.status;
  }

  const recurring = await prisma.recurringTransaction.findMany({
    where,
    select: {
      merchantDisplay: true,
      expectedAmount: true,
      frequency: true,
      status: true,
      nextExpectedDate: true,
      category: { select: { name: true } },
    },
  });

  return recurring.map((r) => ({
    merchant: r.merchantDisplay,
    amount: Math.abs(r.expectedAmount),
    frequency: r.frequency,
    status: r.status,
    category: r.category?.name ?? null,
    nextExpectedDate: r.nextExpectedDate?.toISOString().split('T')[0] ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 10. executeGenerateChart
// ---------------------------------------------------------------------------

type GenerateChartParams = {
  type: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  xLabel?: string;
  yLabel?: string;
  series: { label: string; data: { x: string | number; y: number }[] }[];
};

export function executeGenerateChart(params: GenerateChartParams): ChartSpec {
  return {
    type: params.type,
    title: params.title,
    xLabel: params.xLabel,
    yLabel: params.yLabel,
    series: params.series,
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// AI SDK Tool Definitions
// ---------------------------------------------------------------------------

export function createAgentTools(prisma: PrismaClient) {
  return {
    getCategories: tool({
      description: 'Get all available transaction categories, grouped by parent category.',
      inputSchema: z.object({}),
      execute: async () => executeGetCategories(prisma),
    }),

    queryTransactions: tool({
      description:
        'Search and filter transactions by date range, category, merchant, tag, or amount. Returns up to 100 results. Use the tag filter to find transactions for trips, events, or projects.',
      inputSchema: z.object({
        startDate: z.string().describe('Start date in YYYY-MM-DD format'),
        endDate: z.string().describe('End date in YYYY-MM-DD format'),
        category: z.string().optional().describe('Filter by category name'),
        merchant: z.string().optional().describe('Filter by merchant name (partial match)'),
        tag: z.string().optional().describe('Filter by tag (e.g. trip name, event, project)'),
        minAmount: z.number().optional().describe('Minimum transaction amount'),
        maxAmount: z.number().optional().describe('Maximum transaction amount'),
        limit: z.number().optional().describe('Maximum number of results to return (default 100)'),
      }),
      execute: async (params: QueryTransactionsParams) => executeQueryTransactions(prisma, params),
    }),

    getAccountBalances: tool({
      description: 'Get all active accounts with their current balances.',
      inputSchema: z.object({}),
      execute: async () => executeGetAccountBalances(prisma),
    }),

    getCategoryBreakdown: tool({
      description:
        'Get spending broken down by category for a date range. Only includes expenses (negative amounts).',
      inputSchema: z.object({
        startDate: z.string().describe('Start date in YYYY-MM-DD format'),
        endDate: z.string().describe('End date in YYYY-MM-DD format'),
      }),
      execute: async (params: DateRangeParams) => executeGetCategoryBreakdown(prisma, params),
    }),

    getMerchantBreakdown: tool({
      description:
        'Get spending broken down by merchant for a date range. Only includes expenses (negative amounts).',
      inputSchema: z.object({
        startDate: z.string().describe('Start date in YYYY-MM-DD format'),
        endDate: z.string().describe('End date in YYYY-MM-DD format'),
      }),
      execute: async (params: DateRangeParams) => executeGetMerchantBreakdown(prisma, params),
    }),

    getBudgetStatus: tool({
      description:
        'Get budget vs actual spending for a given month. Shows each budgeted category with limit, actual spend, and remaining.',
      inputSchema: z.object({
        month: z.string().describe('Month in YYYY-MM format'),
      }),
      execute: async (params: BudgetStatusParams) => executeGetBudgetStatus(prisma, params),
    }),

    getMonthlyTrend: tool({
      description:
        'Get income, spending, and net cash flow trend over recent months. Returns data for each month.',
      inputSchema: z.object({
        months: z
          .number()
          .describe('Number of months to include (counting back from current month)'),
      }),
      execute: async (params: MonthlyTrendParams) => executeGetMonthlyTrend(prisma, params),
    }),

    getCashFlow: tool({
      description:
        'Get total income, expenses, and net cash flow for a date range. Excludes transfers.',
      inputSchema: z.object({
        startDate: z.string().describe('Start date in YYYY-MM-DD format'),
        endDate: z.string().describe('End date in YYYY-MM-DD format'),
      }),
      execute: async (params: DateRangeParams) => executeGetCashFlow(prisma, params),
    }),

    getRecurringTransactions: tool({
      description:
        'Get detected recurring transactions (subscriptions, regular bills). Optionally filter by status.',
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe('Filter by status: active, paused, cancelled, or lapsed'),
      }),
      execute: async (params: RecurringParams) => executeGetRecurringTransactions(prisma, params),
    }),

    generateChart: tool({
      description:
        'Generate a chart visualization. Use this when data would be clearer as a visual chart.',
      inputSchema: z.object({
        type: z.enum(['line', 'bar', 'pie', 'area']).describe('Chart type'),
        title: z.string().describe('Chart title'),
        xLabel: z.string().optional().describe('X-axis label'),
        yLabel: z.string().optional().describe('Y-axis label'),
        series: z
          .array(
            z.object({
              label: z.string(),
              data: z.array(
                z.object({
                  x: z.union([z.string(), z.number()]),
                  y: z.number(),
                })
              ),
            })
          )
          .describe('Chart data series'),
      }),
      execute: async (params: GenerateChartParams) => executeGenerateChart(params),
    }),

    pinChart: tool({
      description:
        'Pin a chart to the dashboard for quick reference. Use after generating a chart the user wants to keep.',
      inputSchema: z.object({
        chartSpec: z.object({
          type: z.enum(['line', 'bar', 'pie', 'area']),
          title: z.string(),
          xLabel: z.string().optional(),
          yLabel: z.string().optional(),
          series: z.array(
            z.object({
              label: z.string(),
              data: z.array(
                z.object({
                  x: z.union([z.string(), z.number()]),
                  y: z.number(),
                })
              ),
            })
          ),
        }),
      }),
      execute: async (params: { chartSpec: ChartSpec }) => {
        // Returns the chart spec for the UI to handle pinning
        return { pinned: true, chart: params.chartSpec };
      },
    }),
  };
}
