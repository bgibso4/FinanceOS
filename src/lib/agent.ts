import { PrismaClient } from '@prisma/client';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { analyticQuerySpecSchema, AnalyticQuerySpec, AgentResponse, ChartSpec } from './types';

export function inferSpecFromQuestion(question: string): AnalyticQuerySpec {
  const lower = question.toLowerCase();
  if (lower.includes('merchant')) {
    return {
      metric: 'spend',
      groupBy: 'merchant',
      dateRange: {
        start: startOfMonth(subMonths(new Date(), 1)).toISOString(),
        end: new Date().toISOString(),
      },
      chart: 'bar',
    };
  }
  if (lower.includes('income') && lower.includes('vs')) {
    return {
      metric: 'cashflow',
      groupBy: 'month',
      dateRange: {
        start: startOfMonth(subMonths(new Date(), 5)).toISOString(),
        end: new Date().toISOString(),
      },
      chart: 'line',
    };
  }
  if (lower.includes('category')) {
    return {
      metric: 'categoryBreakdown',
      groupBy: 'category',
      dateRange: {
        start: startOfMonth(subMonths(new Date(), 2)).toISOString(),
        end: new Date().toISOString(),
      },
      chart: 'bar',
    };
  }

  return {
    metric: 'spend',
    groupBy: 'month',
    dateRange: {
      start: startOfMonth(subMonths(new Date(), 2)).toISOString(),
      end: new Date().toISOString(),
    },
    chart: 'line',
  };
}

export async function runAnalyticQuery(
  prisma: PrismaClient,
  rawSpec: unknown
): Promise<AgentResponse> {
  const spec = analyticQuerySpecSchema.parse(rawSpec);
  const start = spec.dateRange
    ? new Date(spec.dateRange.start)
    : startOfMonth(subMonths(new Date(), 2));
  const end = spec.dateRange ? new Date(spec.dateRange.end) : endOfMonth(new Date());

  const where: any = {
    date: { gte: start, lte: end },
    isTransfer: false,
  };
  if (spec.filters?.accounts) where.accountId = { in: spec.filters.accounts };
  if (spec.filters?.categories) where.categoryId = { in: spec.filters.categories };
  if (spec.filters?.merchants) where.merchant = { in: spec.filters.merchants };

  const tx = await prisma.transaction.findMany({ where, include: { category: true } });

  const dataBuckets: Record<string, number> = {};
  for (const t of tx) {
    let key = 'total';
    switch (spec.groupBy) {
      case 'month':
        key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'category':
        key = t.category?.name ?? 'Uncategorized';
        break;
      case 'merchant':
        key = t.merchant;
        break;
      case 'day':
        key = t.date.toISOString().split('T')[0];
        break;
      default:
        key = 'total';
    }

    let value = Number(t.amount);
    if (
      spec.metric === 'spend' ||
      spec.metric === 'categoryBreakdown' ||
      spec.metric === 'merchantBreakdown'
    ) {
      value = Math.abs(Math.min(value, 0));
    } else if (spec.metric === 'income') {
      value = Math.max(value, 0);
    }
    dataBuckets[key] = (dataBuckets[key] ?? 0) + value;
  }

  const seriesData = Object.entries(dataBuckets)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([x, y]) => ({ x, y }));

  const chartSpec: ChartSpec | undefined = spec.chart
    ? {
        type: spec.chart,
        title: `${spec.metric} by ${spec.groupBy}`,
        series: [{ label: spec.metric, data: seriesData }],
      }
    : undefined;

  const total = seriesData.reduce((acc, point) => acc + point.y, 0);
  return {
    textAnswer: `Found ${seriesData.length} points. Total ${spec.metric}: ${total.toFixed(2)}.`,
    chartSpec,
  };
}
