import { z } from "zod";

export type DateRangePreset =
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "ytd"
  | "last-12-months"
  | "custom";

export type FilterParams = {
  startDate?: string;
  endDate?: string;
  accounts?: string[];
  categories?: string[];
  merchant?: string;
  tags?: string[];
};

export const analyticQuerySpecSchema = z.object({
  metric: z.enum(["spend", "income", "savings", "cashflow", "categoryBreakdown", "merchantBreakdown"]),
  groupBy: z.enum(["month", "category", "merchant", "day", "none"]),
  dateRange: z
    .object({
      start: z.string(),
      end: z.string()
    })
    .optional(),
  filters: z
    .object({
      categories: z.array(z.string()).optional(),
      merchants: z.array(z.string()).optional(),
      accounts: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional()
    })
    .optional(),
  chart: z.enum(["line", "bar", "pie", "area"]).optional()
});

export type AnalyticQuerySpec = z.infer<typeof analyticQuerySpecSchema>;

export type ChartSpec = {
  type: "line" | "bar" | "pie" | "area";
  title: string;
  xLabel?: string;
  yLabel?: string;
  series: { label: string; data: { x: string | number; y: number }[] }[];
};

export type AgentResponse = {
  textAnswer: string;
  assumptions?: string[];
  chartSpec?: ChartSpec;
};

export type DashboardPayload = {
  netCashflow: {
    income: number;
    spending: number;
    savings: number;
    prevIncome: number;
    prevSpending: number;
    prevSavings: number;
  };
  savingsRate: {
    rate: number;
    delta: number;
    rollingAvg: number;
  };
  spendByCategory: {
    category: string;
    amount: number;
    monthOverMonth: number;
    isOutlier: boolean;
    txCount: number;
    prevAmount: number;
  }[];
  topMerchants: {
    merchant: string;
    amount: number;
    change: number;
    prevAmount: number;
  }[];
  incomeVsSpending: { month: string; income: number; spending: number }[];
  trendAlerts: { title: string; description: string; deltaPct: number; deltaAmount: number }[];
  transactionCount: number;
  prevTransactionCount: number;
};
