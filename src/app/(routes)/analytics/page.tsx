'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { PeriodPicker } from '@/components/ui/period-picker';
import { ChartRenderer, PIE_COLORS } from '@/components/chart-renderer';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import { CategoryBreakdown } from '@/components/analytics/category-breakdown';
import type { Category, Tx } from '@/components/transactions/types';
import { useDrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import { cn } from '@/lib/cn';
import { ds } from '@/lib/design-system';
import { getCurrencySymbol } from '@/lib/currency';
import { columnLabel, shiftMonths } from '@/lib/analytics-period';
import { localDay } from '@/lib/dates';
import { sendJson } from '@/lib/send-json';

type CategoryAnalytics = {
  category: string;
  categoryId?: string;
  amount: number;
  monthOverMonth: number;
  isOutlier: boolean;
  txCount: number;
  prevAmount: number;
};

type Budget = {
  id: string;
  month: string;
  categoryId: string;
  limitAmount: number;
  category?: Category;
};

// Helper to format currency (uses base currency from state)
const formatCurrency = (amount: number, _baseCurrency: string = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Format with currency symbol
const formatCurrencyWithSymbol = (amount: number, baseCurrency: string = 'USD') => {
  const formatted = formatCurrency(amount, baseCurrency);
  // Hardcode $ for now to test
  return `$${formatted}`;
};

const monthRange = (month: string) => {
  const [year, monthNumber] = month.split('-');
  const lastDay = new Date(parseInt(year), parseInt(monthNumber), 0).getDate();
  return {
    startDate: `${year}-${monthNumber}-01`,
    endDate: `${year}-${monthNumber}-${String(lastDay).padStart(2, '0')}`,
  };
};

const monthColumn = (month: string) => {
  const { startDate, endDate } = monthRange(month);
  return columnLabel({ start: startDate, end: endDate }, { kind: 'month', anchor: month });
};

export default function AnalyticsPage() {
  // Month selector - default to current month
  const [selectedMonth, setSelectedMonth] = useState(() => localDay().slice(0, 7));

  const { refs, error: refsError } = useDrawerReferenceData();
  const { baseCurrency, categories } = refs;
  const [spendByCategory, setSpendByCategory] = useState<CategoryAnalytics[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<Tx[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  // The row the drawer is on stays listed until you leave it, so a save can't lose your place.
  const [heldRowId, setHeldRowId] = useState<string | null>(null);
  // Only the latest request of each kind may land.
  const figureRequests = useRef(0);
  const rowRequests = useRef(0);

  const categoryIdFor = (name: string) => categories.find((c) => c.name === name)?.id;
  const categoryAnalytics = spendByCategory.map((cat) => ({
    ...cat,
    categoryId: categoryIdFor(cat.category),
  }));
  const expandedCategoryId = expandedCategory ? categoryIdFor(expandedCategory) : undefined;

  const loadFigures = useCallback(async () => {
    const seq = ++figureRequests.current;
    const { startDate, endDate } = monthRange(selectedMonth);
    const [budgetData, analyticsData] = await Promise.all([
      sendJson<{ budgets?: Budget[] }>(`/api/budgets/${selectedMonth}`, 'GET'),
      sendJson<{ spendByCategory?: CategoryAnalytics[] }>(
        `/api/analytics/dashboard?preset=custom&startDate=${startDate}&endDate=${endDate}`,
        'GET'
      ),
    ]);
    if (seq !== figureRequests.current) return;
    setBudgets(budgetData.budgets ?? []);
    setSpendByCategory(analyticsData.spendByCategory ?? []);
  }, [selectedMonth]);

  const loadRows = useCallback(async () => {
    if (!expandedCategory) return;
    const seq = ++rowRequests.current;
    const queryParams = new URLSearchParams({ preset: 'custom', ...monthRange(selectedMonth) });
    if (expandedCategoryId) queryParams.set('category', expandedCategoryId);
    try {
      const data = await sendJson<{ transactions?: Tx[] }>(
        `/api/transactions?${queryParams.toString()}`,
        'GET'
      );
      if (seq === rowRequests.current) setCategoryTransactions(data.transactions ?? []);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      if (seq === rowRequests.current) setLoadingTransactions(false);
    }
  }, [expandedCategory, expandedCategoryId, selectedMonth]);

  useEffect(() => {
    loadFigures().catch((err) => console.error('Failed to load analytics:', err));
  }, [loadFigures]);

  useEffect(() => {
    setCategoryTransactions([]);
    setLoadingTransactions(Boolean(expandedCategory));
    void loadRows();
  }, [expandedCategory, loadRows]);

  // Matches what the figures count; with no category id ("Uncategorized") the API returns them all.
  const list = categoryTransactions.filter(
    (t) =>
      t.id === heldRowId ||
      (!t.isOffset && !t.isTransfer && (expandedCategoryId !== undefined || !t.category))
  );

  const drawer = useTransactionDrawer({
    list,
    lookup: list,
    refresh: async () => {
      await Promise.all([loadFigures(), loadRows()]);
    },
    categories,
    patchRows: (patch) => {
      setCategoryTransactions(patch);
      // The row is right already; the figures come from the server.
      loadFigures().catch((err) => console.error('Failed to load analytics:', err));
    },
  });

  useEffect(() => setHeldRowId(drawer.openId), [drawer.openId]);

  // One list at a time: the drawer steps through the open category's rows.
  const toggleCategory = (categoryName: string) =>
    void drawer.closeThen(() =>
      setExpandedCategory((current) => (current === categoryName ? null : categoryName))
    );

  // Calculate totals
  const totalSpending = categoryAnalytics.reduce((sum, c) => sum + c.amount, 0);
  const totalTransactions = categoryAnalytics.reduce((sum, c) => sum + c.txCount, 0);
  const prevTotalSpending = categoryAnalytics.reduce((sum, c) => sum + c.prevAmount, 0);
  const overallChange =
    prevTotalSpending > 0 ? ((totalSpending - prevTotalSpending) / prevTotalSpending) * 100 : 0;

  return (
    <div className={cn('space-y-6', drawer.isOpen && DRAWER_PUSH_CLASS)}>
      {refsError && (
        <p className="text-sm text-[var(--red)]" role="alert">
          {refsError}
        </p>
      )}

      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${ds.text.heading}`}>Monthly Analytics</h1>
          <div className="flex items-center gap-3 mt-1">
            {selectedMonth > localDay().slice(0, 7) && (
              <div className={`text-sm font-medium ${ds.status.warning.text}`}>
                ⚠️ Viewing future month - data may be incomplete
              </div>
            )}
            {baseCurrency && (
              <div className={`text-sm ${ds.text.muted}`}>💱 All amounts in {baseCurrency}</div>
            )}
          </div>
        </div>

        <PeriodPicker
          mode="month"
          value={selectedMonth}
          onChange={(month) => void drawer.closeThen(() => setSelectedMonth(month))}
        />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className={`text-sm ${ds.text.muted}`}>Total Spending</div>
            <div className={`text-3xl font-bold tracking-tight font-mono ${ds.text.primary}`}>
              {formatCurrencyWithSymbol(totalSpending, baseCurrency)}
            </div>
            {overallChange !== 0 && (
              <div
                className={`text-sm mt-1 font-mono ${overallChange > 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}
              >
                {overallChange > 0 ? '↑' : '↓'} {Math.abs(overallChange).toFixed(1)}% vs prev month
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-sm ${ds.text.muted}`}>Transactions</div>
            <div className={`text-3xl font-bold tracking-tight font-mono ${ds.text.primary}`}>
              {totalTransactions}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-sm ${ds.text.muted}`}>Avg per Transaction</div>
            <div className={`text-3xl font-bold tracking-tight font-mono ${ds.text.primary}`}>
              {totalTransactions > 0
                ? formatCurrencyWithSymbol(totalSpending / totalTransactions, baseCurrency)
                : `${getCurrencySymbol(baseCurrency)}0`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pie Chart + Top Categories Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>
              Spending Distribution
            </div>
          </CardHeader>
          <CardContent className="h-80">
            {categoryAnalytics.length > 0 && (
              <ChartRenderer
                spec={{
                  type: 'pie',
                  title: '',
                  series: [
                    {
                      label: 'Spend',
                      data: (() => {
                        // Show top 10 categories, group the rest as "Other"
                        const top10 = categoryAnalytics.slice(0, 10);
                        const rest = categoryAnalytics.slice(10);
                        const otherTotal = rest.reduce((sum, c) => sum + c.amount, 0);

                        const chartData = top10.map((c) => ({ x: c.category, y: c.amount }));
                        if (otherTotal > 0) {
                          chartData.push({ x: 'Other', y: otherTotal });
                        }
                        return chartData;
                      })(),
                    },
                  ],
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Top Categories</div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categoryAnalytics.slice(0, 6).map((cat, idx) => {
                const percentage = totalSpending > 0 ? (cat.amount / totalSpending) * 100 : 0;
                return (
                  <div key={cat.category} className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full ${ds.status.info.bg} flex items-center justify-center text-xs font-semibold ${ds.status.info.text}`}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`font-medium ${ds.text.primary} truncate`}>
                          {cat.category}
                        </span>
                        <span className={`font-semibold ${ds.text.primary} ml-2`}>
                          {formatCurrencyWithSymbol(cat.amount, baseCurrency)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div
                          className={`flex-1 h-1.5 ${ds.bg.tertiary} rounded-full overflow-hidden`}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${percentage}%`,
                              backgroundColor: PIE_COLORS[idx % PIE_COLORS.length],
                            }}
                          />
                        </div>
                        <span className={`text-xs ${ds.text.muted} w-12 text-right`}>
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <CategoryBreakdown
        showBudgets
        budgets={budgets}
        categories={categories}
        columns={{
          current: monthColumn(selectedMonth),
          compare: monthColumn(shiftMonths(`${selectedMonth}-01`, -1).slice(0, 7)),
        }}
        expanded={expandedCategory}
        list={list}
        loading={loadingTransactions}
        rows={categoryAnalytics}
        table={{
          availableTags: refs.availableTags,
          baseCurrency,
          compact: drawer.isOpen,
          openId: drawer.openId,
          onOpen: drawer.openTransaction,
        }}
        onToggle={toggleCategory}
      />

      <TransactionDrawer ref={drawer.ref} {...refs} {...drawer.drawerProps} />
    </div>
  );
}
