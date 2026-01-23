'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { ChartRenderer } from '@/components/chart-renderer';
import { ds } from '@/lib/design-system';
import {
  getCurrencySymbol,
  formatAmountCompact,
  parseExchangeRates,
  convertAmount,
} from '@/lib/currency';

type Category = {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
};

type Tx = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category?: { id: string; name: string } | null;
  confidenceScore: number;
  isTransfer: boolean;
  note?: string | null;
  account?: { id: string; name: string } | null;
  isOffset?: boolean;
  linkedTransaction?: Tx | null;
  offsetTransactions?: Tx[];
};

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
const formatCurrency = (amount: number, baseCurrency: string = 'USD') => {
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

// Strip emojis for sorting purposes
const stripEmojis = (str: string) =>
  str.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '').trim();

const sortByName = (a: { name: string }, b: { name: string }) =>
  stripEmojis(a.name).localeCompare(stripEmojis(b.name));

// Get month name
const getMonthName = (month: string) => {
  const [year, m] = month.split('-');
  const date = new Date(parseInt(year), parseInt(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export default function AnalyticsPage() {
  // Month selector - default to current month
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryAnalytics, setCategoryAnalytics] = useState<CategoryAnalytics[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<Tx[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState<string>('USD');
  const [exchangeRates, setExchangeRates] = useState<Map<string, number>>(new Map());

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Tx | null>(null);

  // Return tracking state
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnTransaction, setReturnTransaction] = useState<Tx | null>(null);
  const [potentialMatches, setPotentialMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedMonth]);

  const loadData = async () => {
    // Load user settings for base currency
    const settingsRes = await fetch('/api/settings');
    const settingsData = await settingsRes.json();
    setBaseCurrency(settingsData.settings?.baseCurrency || 'USD');

    // Load exchange rates
    const ratesRes = await fetch('/api/exchange-rates');
    const ratesData = await ratesRes.json();
    setExchangeRates(parseExchangeRates(ratesData.rates || []));

    // Load categories
    const catRes = await fetch('/api/categories');
    const catData = await catRes.json();
    setCategories(catData.categories ?? []);

    // Load budgets for selected month
    const budgetRes = await fetch(`/api/budgets/${selectedMonth}`);
    const budgetData = await budgetRes.json();
    setBudgets(budgetData.budgets ?? []);

    // Load analytics data for selected month
    const [year, month] = selectedMonth.split('-');
    const startDate = `${year}-${month}-01`;
    // Get last day of the selected month - month is 1-indexed in the string, 0-indexed in Date
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    console.log('Analytics loading for:', {
      selectedMonth,
      startDate,
      endDate,
      lastDayCalc: `new Date(${year}, ${month}, 0) = ${new Date(parseInt(year), parseInt(month), 0).toISOString()}`,
    });

    const analyticsRes = await fetch(
      `/api/analytics/dashboard?preset=custom&startDate=${startDate}&endDate=${endDate}`
    );
    const analyticsData = await analyticsRes.json();

    // Map category names to IDs
    const categoryMap = new Map(catData.categories?.map((c: Category) => [c.name, c.id]) ?? []);
    const enrichedAnalytics = (analyticsData.spendByCategory ?? []).map(
      (cat: CategoryAnalytics) => ({
        ...cat,
        categoryId: categoryMap.get(cat.category),
      })
    );

    setCategoryAnalytics(enrichedAnalytics);
  };

  // Helper to get budget for a category
  const getBudget = (categoryId?: string) => {
    if (!categoryId) return null;
    return budgets.find((b) => b.categoryId === categoryId);
  };

  const loadCategoryTransactions = async (categoryName: string, categoryId?: string) => {
    setLoadingTransactions(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      // Get last day of the selected month
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      const queryParams = new URLSearchParams();
      queryParams.set('preset', 'custom');
      if (categoryId) {
        queryParams.set('category', categoryId);
      }
      queryParams.set('startDate', startDate);
      queryParams.set('endDate', endDate);

      const res = await fetch(`/api/transactions?${queryParams.toString()}`);
      const data = await res.json();

      // Filter out offset transactions - they'll be shown as notes on original transactions
      const filtered = (data.transactions || []).filter((t: Tx) => !t.isOffset);
      setCategoryTransactions(filtered);
    } catch (error) {
      console.error('Failed to load transactions:', error);
      setCategoryTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const toggleCategory = async (categoryName: string, categoryId?: string) => {
    if (expandedCategory === categoryName) {
      setExpandedCategory(null);
      setCategoryTransactions([]);
    } else {
      setExpandedCategory(categoryName);
      await loadCategoryTransactions(categoryName, categoryId);
    }
  };

  const openEditModal = (transaction: Tx) => {
    setEditingTransaction(transaction);
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingTransaction(null);
  };

  const updateTransaction = async () => {
    if (!editingTransaction) return;

    try {
      await fetch(`/api/transactions/${editingTransaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editingTransaction.date,
          amount: editingTransaction.amount,
          merchant: editingTransaction.merchant,
          categoryId: editingTransaction.category?.id || null,
          note: editingTransaction.note,
          isTransfer: editingTransaction.isTransfer,
        }),
      });

      closeEditModal();
      if (expandedCategory) {
        const cat = categoryAnalytics.find((c) => c.category === expandedCategory);
        await loadCategoryTransactions(expandedCategory, cat?.categoryId);
      }
      loadData();
    } catch (error) {
      alert('Failed to update transaction');
    }
  };

  const deleteTransaction = async () => {
    if (!editingTransaction) return;
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    try {
      await fetch(`/api/transactions/${editingTransaction.id}`, {
        method: 'DELETE',
      });

      closeEditModal();
      if (expandedCategory) {
        const cat = categoryAnalytics.find((c) => c.category === expandedCategory);
        await loadCategoryTransactions(expandedCategory, cat?.categoryId);
      }
      loadData();
    } catch (error) {
      alert('Failed to delete transaction');
    }
  };

  const toggleTransfer = async () => {
    if (!editingTransaction) return;

    try {
      await fetch(`/api/transactions/${editingTransaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTransfer: !editingTransaction.isTransfer,
          transferGroupId: null,
        }),
      });

      setEditingTransaction({
        ...editingTransaction,
        isTransfer: !editingTransaction.isTransfer,
      });

      loadData();
      if (expandedCategory) {
        const cat = categoryAnalytics.find((c) => c.category === expandedCategory);
        await loadCategoryTransactions(expandedCategory, cat?.categoryId);
      }
    } catch (error) {
      alert('Failed to update transfer status');
    }
  };

  const openReturnModal = async (transaction: Tx) => {
    setReturnTransaction(transaction);
    setReturnModalOpen(true);
    setLoadingMatches(true);
    setPotentialMatches([]);

    try {
      const res = await fetch(`/api/transactions/${transaction.id}/returns`);
      const data = await res.json();
      setPotentialMatches(data.matches || []);
    } catch (error) {
      console.error('Failed to load potential matches:', error);
    } finally {
      setLoadingMatches(false);
    }
  };

  const linkReturn = async (originalTransactionId: string) => {
    if (!returnTransaction) return;

    try {
      await fetch(`/api/transactions/${returnTransaction.id}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalTransactionId }),
      });
      setReturnModalOpen(false);
      loadData();
      if (expandedCategory) {
        const cat = categoryAnalytics.find((c) => c.category === expandedCategory);
        await loadCategoryTransactions(expandedCategory, cat?.categoryId);
      }
    } catch (error) {
      alert('Failed to link return');
    }
  };

  const unlinkReturn = async (transactionId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}/returns`, {
        method: 'DELETE',
      });
      loadData();
      if (expandedCategory) {
        const cat = categoryAnalytics.find((c) => c.category === expandedCategory);
        await loadCategoryTransactions(expandedCategory, cat?.categoryId);
      }
    } catch (error) {
      alert('Failed to unlink return');
    }
  };

  // Calculate totals
  const totalSpending = categoryAnalytics.reduce((sum, c) => sum + c.amount, 0);
  const totalTransactions = categoryAnalytics.reduce((sum, c) => sum + c.txCount, 0);
  const prevTotalSpending = categoryAnalytics.reduce((sum, c) => sum + c.prevAmount, 0);
  const overallChange =
    prevTotalSpending > 0 ? ((totalSpending - prevTotalSpending) / prevTotalSpending) * 100 : 0;

  // Month selector state
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [selectedYear, selectedMonthNum] = selectedMonth.split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const selectMonth = (monthIndex: number, year: number = selectedYear) => {
    setSelectedMonth(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
    setShowMonthPicker(false);
  };

  const goToPrevMonth = () => {
    const newDate = new Date(selectedYear, selectedMonthNum - 2);
    setSelectedMonth(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`);
  };

  const goToNextMonth = () => {
    const newDate = new Date(selectedYear, selectedMonthNum);
    const now = new Date();
    if (newDate <= now) {
      setSelectedMonth(
        `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`
      );
    }
  };

  const [pickerYear, setPickerYear] = useState(selectedYear);

  return (
    <div className="space-y-6">
      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${ds.text.heading}`}>Monthly Analytics</h1>
          <div className="flex items-center gap-3 mt-1">
            {new Date(selectedMonth + '-01') > new Date() && (
              <div className={`text-sm font-medium ${ds.status.warning.text}`}>
                ⚠️ Viewing future month - data may be incomplete
              </div>
            )}
            {baseCurrency && (
              <div className={`text-sm ${ds.text.muted}`}>💱 All amounts in {baseCurrency}</div>
            )}
          </div>
        </div>

        {/* Month Selector */}
        <div className="relative flex items-center gap-1">
          <button
            className={`p-2 rounded-lg transition-colors ${ds.interactive.default}`}
            onClick={goToPrevMonth}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M15 19l-7-7 7-7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </button>

          <button
            className={`px-4 py-2 ${ds.bg.primary} border ${ds.border.default} rounded-lg font-semibold ${ds.text.primary} ${ds.bg.hover} transition-colors min-w-[180px] text-center flex items-center justify-center gap-2`}
            onClick={() => {
              setPickerYear(selectedYear);
              setShowMonthPicker(!showMonthPicker);
            }}
          >
            {getMonthName(selectedMonth)}
            <svg
              className={`w-4 h-4 transition-transform ${showMonthPicker ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M19 9l-7 7-7-7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </button>

          <button
            className={`p-2 rounded-lg transition-colors ${ds.interactive.default}`}
            onClick={goToNextMonth}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
            </svg>
          </button>

          {/* Month Picker Dropdown */}
          {showMonthPicker && (
            <div
              className={`absolute top-full right-0 mt-2 ${ds.bg.primary} border ${ds.border.default} rounded-xl shadow-lg p-4 z-50`}
            >
              <div className="flex items-center justify-between mb-3">
                <button
                  className={`p-1 rounded ${ds.interactive.default}`}
                  onClick={() => setPickerYear(pickerYear - 1)}
                >
                  ←
                </button>
                <span className={`font-semibold ${ds.text.primary}`}>{pickerYear}</span>
                <button
                  className={`p-1 rounded ${ds.interactive.default}`}
                  onClick={() => setPickerYear(pickerYear + 1)}
                >
                  →
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {months.map((month, idx) => {
                  const monthStr = `${pickerYear}-${String(idx + 1).padStart(2, '0')}`;
                  const isSelected = monthStr === selectedMonth;
                  const isFuture = new Date(pickerYear, idx) > new Date();

                  return (
                    <button
                      key={month}
                      className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : isFuture
                            ? `${ds.text.muted} cursor-not-allowed`
                            : `${ds.text.secondary} ${ds.bg.hover}`
                      }`}
                      disabled={isFuture}
                      onClick={() => !isFuture && selectMonth(idx, pickerYear)}
                    >
                      {month}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className={`text-sm ${ds.text.muted}`}>Total Spending</div>
            <div className={`text-3xl font-bold ${ds.text.primary}`}>
              {formatCurrencyWithSymbol(totalSpending, baseCurrency)}
            </div>
            {overallChange !== 0 && (
              <div
                className={`text-sm mt-1 ${overallChange > 0 ? 'text-red-600' : 'text-green-600'}`}
              >
                {overallChange > 0 ? '↑' : '↓'} {Math.abs(overallChange).toFixed(1)}% vs prev month
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-sm ${ds.text.muted}`}>Transactions</div>
            <div className={`text-3xl font-bold ${ds.text.primary}`}>{totalTransactions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-sm ${ds.text.muted}`}>Avg per Transaction</div>
            <div className={`text-3xl font-bold ${ds.text.primary}`}>
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
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${percentage}%` }}
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

      {/* Category Breakdown with Transaction Drill-down */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>
              Category Breakdown by Group
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {(() => {
              // Group categories by their parent
              const grouped: Record<string, typeof categoryAnalytics> = {};

              categoryAnalytics.forEach((cat) => {
                const category = categories.find((c) => c.name === cat.category);
                const parentGroup = category?.parentId
                  ? categories.find((c) => c.id === category.parentId)
                  : null;

                const groupName = parentGroup?.name || 'Uncategorized';
                grouped[groupName] = grouped[groupName] || [];
                grouped[groupName].push(cat);
              });

              // Sort groups by total absolute value
              const sortedGroups = Object.entries(grouped).sort(([, aCats], [, bCats]) => {
                const aTotal = Math.abs(aCats.reduce((sum, c) => sum + c.amount, 0));
                const bTotal = Math.abs(bCats.reduce((sum, c) => sum + c.amount, 0));
                return bTotal - aTotal;
              });

              return sortedGroups.map(([groupName, cats]) => {
                const groupTotal = cats.reduce((sum, c) => sum + c.amount, 0);

                return (
                  <div
                    key={groupName}
                    className={`border ${ds.border.default} rounded-lg overflow-hidden`}
                  >
                    {/* Group Header */}
                    <div className={`p-3 ${ds.bg.tertiary}`}>
                      <div className="flex items-center justify-between">
                        <span className={`font-bold ${ds.text.primary}`}>{groupName}</span>
                        <span className={`font-bold text-lg ${ds.text.primary}`}>
                          {formatCurrencyWithSymbol(Math.abs(groupTotal), baseCurrency)}
                        </span>
                      </div>
                    </div>

                    {/* Categories in Group */}
                    <div className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
                      {cats.map((cat) => {
                        const percentage =
                          totalSpending > 0 ? (cat.amount / totalSpending) * 100 : 0;
                        const isExpanded = expandedCategory === cat.category;
                        const budget = getBudget(cat.categoryId);
                        const budgetPercentage = budget
                          ? (cat.amount / budget.limitAmount) * 100
                          : null;
                        const isOverBudget = budgetPercentage !== null && budgetPercentage > 100;

                        return (
                          <div key={cat.category}>
                            {/* Category Header */}
                            <div
                              className={`p-4 cursor-pointer transition-all ${isExpanded ? ds.bg.secondary : ds.bg.hover}`}
                              onClick={() => toggleCategory(cat.category, cat.categoryId)}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                  >
                                    ▶
                                  </span>
                                  <span className={`font-semibold ${ds.text.primary}`}>
                                    {cat.category}
                                  </span>
                                  <span className={`text-sm ${ds.text.muted}`}>
                                    {cat.txCount} transactions
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  {cat.monthOverMonth !== 0 && (
                                    <span
                                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                        cat.monthOverMonth > 0
                                          ? `${ds.status.error.bg} ${ds.status.error.text}`
                                          : `${ds.status.success.bg} ${ds.status.success.text}`
                                      }`}
                                    >
                                      {cat.monthOverMonth > 0 ? '↑' : '↓'}{' '}
                                      {Math.abs(cat.monthOverMonth).toFixed(0)}%
                                    </span>
                                  )}
                                  <span className={`font-bold ${ds.text.primary}`}>
                                    {formatCurrencyWithSymbol(cat.amount, baseCurrency)}
                                  </span>
                                </div>
                              </div>

                              {/* Budget progress */}
                              {budget && (
                                <div className="mt-3 ml-7">
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span
                                      className={
                                        isOverBudget
                                          ? 'text-red-600 font-medium'
                                          : ds.text.secondary
                                      }
                                    >
                                      {budgetPercentage!.toFixed(0)}% of{' '}
                                      {formatCurrencyWithSymbol(budget.limitAmount, baseCurrency)}{' '}
                                      budget
                                    </span>
                                    <span
                                      className={
                                        isOverBudget ? 'text-red-600 font-medium' : ds.text.muted
                                      }
                                    >
                                      {isOverBudget
                                        ? `${formatCurrencyWithSymbol(cat.amount - budget.limitAmount, baseCurrency)} over`
                                        : `${formatCurrencyWithSymbol(budget.limitAmount - cat.amount, baseCurrency)} left`}
                                    </span>
                                  </div>
                                  <div
                                    className={`h-2 ${ds.bg.tertiary} rounded-full overflow-hidden`}
                                  >
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        isOverBudget
                                          ? 'bg-red-500'
                                          : budgetPercentage! > 80
                                            ? 'bg-amber-500'
                                            : 'bg-green-500'
                                      }`}
                                      style={{ width: `${Math.min(budgetPercentage!, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Expanded Transaction List */}
                            {isExpanded && (
                              <div className={`border-t ${ds.border.default} ${ds.bg.primary}`}>
                                {/* Stats Row */}
                                <div
                                  className={`grid grid-cols-4 gap-4 p-4 ${ds.bg.secondary} border-b ${ds.border.default}`}
                                >
                                  <div>
                                    <div className={`text-xs ${ds.text.muted}`}>This Month</div>
                                    <div className="font-semibold">
                                      {formatCurrencyWithSymbol(cat.amount, baseCurrency)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className={`text-xs ${ds.text.muted}`}>
                                      {budget ? 'Budget' : 'Last Month'}
                                    </div>
                                    <div className="font-semibold">
                                      {budget
                                        ? formatCurrencyWithSymbol(budget.limitAmount, baseCurrency)
                                        : formatCurrencyWithSymbol(cat.prevAmount, baseCurrency)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className={`text-xs ${ds.text.muted}`}>
                                      {budget ? 'Remaining' : 'Change'}
                                    </div>
                                    <div
                                      className={`font-semibold ${
                                        budget
                                          ? budget.limitAmount - cat.amount >= 0
                                            ? 'text-green-600'
                                            : 'text-red-600'
                                          : cat.monthOverMonth > 0
                                            ? 'text-red-600'
                                            : 'text-green-600'
                                      }`}
                                    >
                                      {budget
                                        ? formatCurrencyWithSymbol(
                                            budget.limitAmount - cat.amount,
                                            baseCurrency
                                          )
                                        : `${cat.monthOverMonth > 0 ? '+' : ''}${formatCurrencyWithSymbol(cat.amount - cat.prevAmount, baseCurrency)}`}
                                    </div>
                                  </div>
                                  <div>
                                    <div className={`text-xs ${ds.text.muted}`}>
                                      Avg per Transaction
                                    </div>
                                    <div className="font-semibold">
                                      {cat.txCount > 0
                                        ? formatCurrencyWithSymbol(
                                            cat.amount / cat.txCount,
                                            baseCurrency
                                          )
                                        : '—'}
                                    </div>
                                  </div>
                                </div>

                                {/* Transaction List */}
                                {loadingTransactions ? (
                                  <div className={`p-4 text-center ${ds.text.muted}`}>
                                    Loading transactions...
                                  </div>
                                ) : categoryTransactions.length === 0 ? (
                                  <div className={`p-4 text-center ${ds.text.muted}`}>
                                    No transactions found
                                  </div>
                                ) : (
                                  <div className="max-h-96 overflow-y-auto">
                                    <table className="w-full">
                                      <thead className={`${ds.table.header} sticky top-0`}>
                                        <tr className={`text-left text-xs ${ds.text.muted}`}>
                                          <th className="p-3 font-medium">Date</th>
                                          <th className="p-3 font-medium">Merchant</th>
                                          <th className="p-3 font-medium">Account</th>
                                          <th className="p-3 font-medium text-right">Amount</th>
                                          <th className="p-3 font-medium w-10" />
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {categoryTransactions.map((tx) => (
                                          <React.Fragment key={tx.id}>
                                            <tr
                                              className={`border-t ${ds.table.row} cursor-pointer`}
                                              onClick={() => openEditModal(tx)}
                                            >
                                              <td className={`p-3 text-sm ${ds.text.secondary}`}>
                                                {tx.date.split('T')[0]}
                                              </td>
                                              <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                  {tx.isOffset && (
                                                    <span className={ds.status.info.text}>↩</span>
                                                  )}
                                                  <div className="flex-1">
                                                    <div
                                                      className={`font-medium ${ds.text.primary}`}
                                                    >
                                                      {tx.merchant}
                                                    </div>
                                                    {tx.note && (
                                                      <div
                                                        className={`text-xs ${ds.text.muted} truncate max-w-xs`}
                                                      >
                                                        {tx.note}
                                                      </div>
                                                    )}
                                                    {tx.isOffset && tx.linkedTransaction && (
                                                      <div
                                                        className={`text-xs ${ds.status.info.text} mt-1`}
                                                      >
                                                        Offsets{' '}
                                                        {tx.linkedTransaction.date.split('T')[0]}{' '}
                                                        transaction
                                                      </div>
                                                    )}
                                                    {!tx.isOffset &&
                                                      tx.offsetTransactions &&
                                                      tx.offsetTransactions.length > 0 && (
                                                        <div
                                                          className={`text-xs ${ds.status.purple.text} mt-1`}
                                                        >
                                                          Offset $
                                                          {tx.offsetTransactions
                                                            .reduce(
                                                              (sum, r) => sum + Math.abs(r.amount),
                                                              0
                                                            )
                                                            .toFixed(2)}
                                                          {tx.offsetTransactions[0] &&
                                                            ` on ${tx.offsetTransactions[0].date.split('T')[0]}`}
                                                        </div>
                                                      )}
                                                  </div>
                                                </div>
                                              </td>
                                              <td className={`p-3 text-sm ${ds.text.secondary}`}>
                                                {tx.account?.name || '—'}
                                              </td>
                                              <td
                                                className={`p-3 text-sm font-semibold text-right ${
                                                  tx.amount >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}
                                              >
                                                {(() => {
                                                  const accountCurrency = 'USD'; // Default since account.currency doesn't exist in type
                                                  const isBaseCurrency =
                                                    accountCurrency === baseCurrency;
                                                  const convertedAmount = isBaseCurrency
                                                    ? tx.amount
                                                    : convertAmount(
                                                        tx.amount,
                                                        accountCurrency,
                                                        baseCurrency,
                                                        exchangeRates
                                                      );

                                                  // Calculate net amount if there are linked transactions
                                                  const hasLinked =
                                                    !tx.isOffset &&
                                                    tx.offsetTransactions &&
                                                    tx.offsetTransactions.length > 0;
                                                  const linkedTotal =
                                                    hasLinked && tx.offsetTransactions
                                                      ? tx.offsetTransactions.reduce(
                                                          (sum, r) => sum + r.amount,
                                                          0
                                                        )
                                                      : 0;
                                                  const netAmount = convertedAmount + linkedTotal;

                                                  return (
                                                    <>
                                                      {/* Show NET as main amount */}
                                                      {netAmount >= 0 ? '+' : ''}
                                                      {formatCurrencyWithSymbol(
                                                        Math.abs(netAmount),
                                                        baseCurrency
                                                      )}

                                                      {/* Show original currency if different */}
                                                      {!isBaseCurrency && (
                                                        <div
                                                          className={`text-xs ${ds.text.muted} font-normal mt-1`}
                                                        >
                                                          {formatAmountCompact(
                                                            Math.abs(tx.amount),
                                                            accountCurrency,
                                                            baseCurrency
                                                          )}
                                                        </div>
                                                      )}

                                                      {/* Show gross amount if there are linked transactions */}
                                                      {hasLinked && (
                                                        <div
                                                          className={`text-xs ${ds.text.muted} font-normal mt-1`}
                                                        >
                                                          Original:{' '}
                                                          {formatCurrencyWithSymbol(
                                                            Math.abs(convertedAmount),
                                                            baseCurrency
                                                          )}
                                                        </div>
                                                      )}
                                                    </>
                                                  );
                                                })()}
                                              </td>
                                              <td className={`p-3 ${ds.text.muted}`}>
                                                <svg
                                                  className="w-4 h-4"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  viewBox="0 0 24 24"
                                                >
                                                  <path
                                                    d="M9 5l7 7-7 7"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                  />
                                                </svg>
                                              </td>
                                            </tr>
                                          </React.Fragment>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Transaction Edit Modal */}
      <Modal
        isOpen={editModalOpen}
        title={
          editingTransaction
            ? `Edit Transaction: ${editingTransaction.merchant}`
            : 'Edit Transaction'
        }
        onClose={closeEditModal}
      >
        {editingTransaction && (
          <div className="space-y-6">
            {/* Edit Transaction */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Transaction Details</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                      Date
                    </label>
                    <Input
                      className="w-full"
                      type="date"
                      value={new Date(editingTransaction.date).toISOString().split('T')[0]}
                      onChange={(e) =>
                        setEditingTransaction({
                          ...editingTransaction,
                          date: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                      Amount
                    </label>
                    <Input
                      className="w-full"
                      step="0.01"
                      type="number"
                      value={editingTransaction.amount}
                      onChange={(e) =>
                        setEditingTransaction({
                          ...editingTransaction,
                          amount: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Merchant
                  </label>
                  <Input
                    className="w-full"
                    placeholder="Merchant name"
                    value={editingTransaction.merchant}
                    onChange={(e) =>
                      setEditingTransaction({
                        ...editingTransaction,
                        merchant: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Category
                  </label>
                  <Select
                    className="w-full"
                    value={editingTransaction.category?.id || ''}
                    onChange={(e) => {
                      const selectedCategory = categories.find((c) => c.id === e.target.value);
                      setEditingTransaction({
                        ...editingTransaction,
                        category: selectedCategory
                          ? { id: selectedCategory.id, name: selectedCategory.name }
                          : null,
                      });
                    }}
                  >
                    <option value="">No category</option>
                    {categories
                      .filter((c) => !c.parentId)
                      .sort(sortByName)
                      .map((group) => {
                        const groupCategories = categories
                          .filter((c) => c.parentId === group.id)
                          .sort(sortByName);
                        if (groupCategories.length === 0) return null;

                        return (
                          <optgroup key={group.id} label={group.name}>
                            {groupCategories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                  </Select>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                    Account
                  </label>
                  <Input
                    disabled
                    className="w-full !bg-slate-100 dark:!bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed opacity-75"
                    value={editingTransaction.account?.name || 'Unknown'}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Note
                  </label>
                  <Input
                    className="w-full"
                    placeholder="Add a note about this transaction..."
                    value={editingTransaction.note || ''}
                    onChange={(e) =>
                      setEditingTransaction({
                        ...editingTransaction,
                        note: e.target.value,
                      })
                    }
                  />
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                  onClick={updateTransaction}
                >
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Transaction Info */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Transaction Info</h4>
              <div className={`text-sm ${ds.text.secondary} space-y-1`}>
                <div>
                  <strong>Confidence Score:</strong>{' '}
                  {(editingTransaction.confidenceScore * 100).toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Transfer Status */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.info.text} mb-3`}>Transfer Status</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${ds.text.secondary}`}>
                    {editingTransaction.isTransfer
                      ? 'This transaction is marked as a transfer between accounts'
                      : 'This transaction counts toward spending/income totals'}
                  </span>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      editingTransaction.isTransfer
                        ? `${ds.status.info.bg} ${ds.status.info.text}`
                        : `${ds.bg.tertiary} ${ds.text.secondary}`
                    }`}
                  >
                    {editingTransaction.isTransfer ? 'Transfer' : 'Normal'}
                  </span>
                </div>
                <Button
                  className="w-full py-3 !bg-blue-600 hover:!bg-blue-700 text-white"
                  onClick={toggleTransfer}
                >
                  {editingTransaction.isTransfer ? 'Unmark as Transfer' : 'Mark as Transfer'}
                </Button>
                <div className={`text-xs ${ds.text.muted}`}>
                  {editingTransaction.isTransfer
                    ? 'Unmarking will include this in spending/income calculations'
                    : 'Transfers (like credit card payments) are excluded from spending totals'}
                </div>
              </div>
            </div>

            {/* Linked Transaction Tracking */}
            {!editingTransaction.isTransfer && (
              <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
                <h4 className={`font-semibold ${ds.status.purple.text} mb-3`}>
                  Linked Transactions
                </h4>
                {editingTransaction.isOffset && editingTransaction.linkedTransaction ? (
                  <div className="space-y-3">
                    <div
                      className={`text-sm ${ds.status.purple.text} ${ds.status.purple.bg} p-3 rounded border ${ds.status.purple.border}`}
                    >
                      ↩ This transaction is linked to an original transaction
                    </div>
                    {editingTransaction.linkedTransaction && (
                      <div
                        className={`${ds.bg.primary} p-3 rounded border ${ds.status.purple.border}`}
                      >
                        <div className={`text-sm font-medium ${ds.text.primary} mb-2`}>
                          Original Transaction:
                        </div>
                        <div className={`text-sm ${ds.text.primary}`}>
                          <div>
                            <strong>Merchant:</strong>{' '}
                            {editingTransaction.linkedTransaction.merchant}
                          </div>
                          <div>
                            <strong>Amount:</strong> $
                            {Math.abs(editingTransaction.linkedTransaction.amount).toFixed(2)}
                          </div>
                          <div>
                            <strong>Date:</strong>{' '}
                            {editingTransaction.linkedTransaction.date.split('T')[0]}
                          </div>
                        </div>
                      </div>
                    )}
                    <Button
                      className="w-full !bg-purple-600 hover:!bg-purple-700 py-3 text-white"
                      onClick={() => {
                        unlinkReturn(editingTransaction.id);
                        closeEditModal();
                      }}
                    >
                      Unlink Transaction
                    </Button>
                  </div>
                ) : editingTransaction.offsetTransactions &&
                  editingTransaction.offsetTransactions.length > 0 ? (
                  <div className="space-y-3">
                    <div
                      className={`text-sm ${ds.status.purple.text} ${ds.status.purple.bg} p-3 rounded border ${ds.status.purple.border}`}
                    >
                      This transaction has {editingTransaction.offsetTransactions.length} linked
                      transaction{editingTransaction.offsetTransactions.length > 1 ? 's' : ''}
                    </div>
                    {editingTransaction.offsetTransactions.map((ret: any) => (
                      <div
                        key={ret.id}
                        className={`flex items-center justify-between p-2 ${ds.bg.primary} rounded border`}
                      >
                        <div className="text-sm">
                          <div className="font-medium">
                            ${Math.abs(ret.amount).toFixed(2)} linked
                          </div>
                          <div className={`text-xs ${ds.text.muted}`}>{ret.date.split('T')[0]}</div>
                        </div>
                        <button
                          className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
                          onClick={() => {
                            unlinkReturn(ret.id);
                            closeEditModal();
                          }}
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button
                    className="w-full !bg-purple-600 hover:!bg-purple-700 py-3 text-white"
                    onClick={() => {
                      closeEditModal();
                      openReturnModal(editingTransaction);
                    }}
                  >
                    🔗 Link Transaction
                  </Button>
                )}
              </div>
            )}

            {/* Delete */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.status.error.text} mb-3`}>Danger Zone</h4>
              <Button
                className="w-full !bg-red-600 hover:!bg-red-700 py-3 text-white"
                onClick={deleteTransaction}
              >
                Delete Transaction
              </Button>
              <div className={`text-sm ${ds.text.secondary} mt-2`}>
                This action cannot be undone
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
