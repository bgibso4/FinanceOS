'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ds } from '@/lib/design-system';
import { NetWorthSnapshots } from '@/components/reports/NetWorthSnapshots';

type Category = { id: string; name: string; type: string; parentId?: string | null };

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

function ReportsContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'net-worth';

  const [categories, setCategories] = useState<Category[]>([]);

  // Monthly report state
  const [reportMonth, setReportMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reportData, setReportData] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [trailing12Months, setTrailing12Months] = useState<any[]>([]);
  const [trailing12EndMonth, setTrailing12EndMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [backfillForm, setBackfillForm] = useState({
    year: '2024',
    month: '01',
    income: '',
    spending: '',
  });

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (tab === 'monthly') {
      loadMonthlyReport(reportMonth);
    }
  }, [tab, reportMonth]);

  useEffect(() => {
    if (tab === 'cash-flow') {
      loadTrailing12Months(trailing12EndMonth);
    }
  }, [tab, trailing12EndMonth]);

  const loadCategories = async () => {
    const res = await fetch('/api/categories');
    const data = await res.json();
    setCategories(data.categories ?? []);
  };

  const loadMonthlyReport = async (month: string) => {
    try {
      const [year, m] = month.split('-');
      const startDate = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      const endDate = `${year}-${m}-${String(lastDay).padStart(2, '0')}`;

      const res = await fetch(
        `/api/analytics/dashboard?preset=custom&startDate=${startDate}&endDate=${endDate}`
      );
      const data = await res.json();
      setReportData(data);
    } catch (error) {
      console.error('Failed to load monthly report:', error);
    }
  };

  const loadTrailing12Months = async (endMonth: string) => {
    try {
      const res = await fetch(`/api/reports/trailing-12-months?month=${endMonth}`);
      const data = await res.json();
      setTrailing12Months(data.months ?? []);
    } catch (error) {
      console.error('Failed to load trailing 12 months:', error);
    }
  };

  const goToPrev12Months = () => {
    const [year, month] = trailing12EndMonth.split('-').map(Number);
    const prev = new Date(year, month - 13);
    setTrailing12EndMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  };

  const goToNext12Months = () => {
    const [year, month] = trailing12EndMonth.split('-').map(Number);
    const next = new Date(year, month + 11);
    setTrailing12EndMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  const backfillSnapshot = async () => {
    if (
      !backfillForm.year ||
      !backfillForm.month ||
      !backfillForm.income ||
      !backfillForm.spending
    ) {
      alert('Please fill in all fields');
      return;
    }

    const month = `${backfillForm.year}-${backfillForm.month}`;
    try {
      await fetch('/api/reports/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          income: parseFloat(backfillForm.income),
          spending: parseFloat(backfillForm.spending),
        }),
      });
      setBackfillForm({ year: '2024', month: '01', income: '', spending: '' });
      loadTrailing12Months(trailing12EndMonth);
      alert('Historical data saved successfully!');
    } catch (error) {
      console.error('Failed to backfill snapshot:', error);
      alert('Failed to save historical data');
    }
  };

  return (
    <div className="space-y-6">
      {/* Net Worth Tab */}
      {tab === 'net-worth' && <NetWorthSnapshots />}

      {/* Cash Flow Tab (12 Month Savings Rate) */}
      {tab === 'cash-flow' && (
        <div className="space-y-6">
          {trailing12Months.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className={`text-sm font-semibold ${ds.text.primary}`}>
                    12 Month Savings Rate
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className={`p-1.5 rounded-lg transition-colors ${ds.interactive.default}`}
                      onClick={goToPrev12Months}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M15 19l-7-7 7-7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                        />
                      </svg>
                    </button>
                    <span className={`text-sm ${ds.text.secondary} min-w-[120px] text-center`}>
                      {trailing12Months[0]?.label} -{' '}
                      {trailing12Months[trailing12Months.length - 1]?.label}
                    </span>
                    <button
                      className={`p-1.5 rounded-lg transition-colors ${ds.interactive.default}`}
                      onClick={goToNext12Months}
                    >
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
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={ds.bg.tertiary}>
                      <tr>
                        <th
                          className={`px-3 py-2 text-left ${ds.text.secondary} font-semibold sticky left-0 ${ds.bg.tertiary}`}
                        >
                          Metric
                        </th>
                        {trailing12Months.map((m) => (
                          <th
                            key={m.month}
                            className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold whitespace-nowrap`}
                          >
                            {m.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${ds.border.default}`}>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td
                          className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}
                        >
                          Income
                        </td>
                        {trailing12Months.map((m) => (
                          <td
                            key={m.month}
                            className="px-3 py-2 text-right text-green-600 font-semibold"
                          >
                            {formatCurrency(m.income)}
                          </td>
                        ))}
                      </tr>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td
                          className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}
                        >
                          Spending
                        </td>
                        {trailing12Months.map((m) => (
                          <td
                            key={m.month}
                            className="px-3 py-2 text-right text-red-600 font-semibold"
                          >
                            {formatCurrency(m.spending)}
                          </td>
                        ))}
                      </tr>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td
                          className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}
                        >
                          Savings
                        </td>
                        {trailing12Months.map((m) => (
                          <td
                            key={m.month}
                            className={`px-3 py-2 text-right font-semibold ${m.savings >= 0 ? 'text-green-600' : 'text-red-600'}`}
                          >
                            {formatCurrency(m.savings)}
                          </td>
                        ))}
                      </tr>
                      <tr className={`hover:${ds.bg.secondary}`}>
                        <td
                          className={`px-3 py-2 ${ds.text.primary} font-medium sticky left-0 ${ds.bg.primary}`}
                        >
                          Savings Rate
                        </td>
                        {trailing12Months.map((m) => (
                          <td
                            key={m.month}
                            className={`px-3 py-2 text-right font-bold ${m.savingsRate >= 0 ? 'text-green-600' : 'text-red-600'}`}
                          >
                            {(m.savingsRate * 100).toFixed(1)}%
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <div className={ds.text.muted}>Loading 12 month data...</div>
              </CardContent>
            </Card>
          )}

          {/* Backfill Historical Data */}
          <details className={`${ds.bg.secondary} rounded-lg border ${ds.border.default}`}>
            <summary
              className={`cursor-pointer p-4 font-medium text-sm ${ds.text.primary} hover:${ds.bg.tertiary}`}
            >
              Backfill Historical Data (for months without transactions)
            </summary>
            <div className="px-4 pb-4">
              <div className={`text-sm ${ds.text.secondary} mb-4`}>
                Add summary data for months where you don&apos;t have individual transactions
              </div>
              <div className="grid grid-cols-5 gap-3">
                <Select
                  value={backfillForm.year}
                  onChange={(e) => setBackfillForm({ ...backfillForm, year: e.target.value })}
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - i;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </Select>
                <Select
                  value={backfillForm.month}
                  onChange={(e) => setBackfillForm({ ...backfillForm, month: e.target.value })}
                >
                  <option value="01">January</option>
                  <option value="02">February</option>
                  <option value="03">March</option>
                  <option value="04">April</option>
                  <option value="05">May</option>
                  <option value="06">June</option>
                  <option value="07">July</option>
                  <option value="08">August</option>
                  <option value="09">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </Select>
                <Input
                  placeholder="Income"
                  step="0.01"
                  type="number"
                  value={backfillForm.income}
                  onChange={(e) => setBackfillForm({ ...backfillForm, income: e.target.value })}
                />
                <Input
                  placeholder="Spending"
                  step="0.01"
                  type="number"
                  value={backfillForm.spending}
                  onChange={(e) => setBackfillForm({ ...backfillForm, spending: e.target.value })}
                />
                <Button
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={backfillSnapshot}
                >
                  Add Snapshot
                </Button>
              </div>
              <div className={`text-xs ${ds.text.muted} mt-2`}>
                Savings and savings rate are calculated automatically. If transactions exist for a
                month, they take priority.
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Monthly Detail Tab */}
      {tab === 'monthly' && (
        <div className="space-y-6">
          {/* Month Selector */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className={`text-sm font-semibold ${ds.text.primary}`}>Monthly Detail</div>
                <select
                  className={`rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary}`}
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                >
                  {Array.from({ length: 24 }, (_, i) => {
                    const d = new Date();
                    d.setMonth(d.getMonth() - i);
                    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    return (
                      <option key={`report-month-${i}`} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            </CardHeader>
          </Card>

          {reportData && (
            <>
              <Card>
                <CardHeader>
                  <div className={`text-sm font-semibold ${ds.text.primary}`}>Summary</div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                        Cash In
                      </div>
                      <div className="text-2xl font-bold text-green-600">
                        {formatCurrency(reportData.netCashflow.income)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                        Cash Out
                      </div>
                      <div className="text-2xl font-bold text-red-600">
                        -{formatCurrency(reportData.netCashflow.spending)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                        Savings Rate
                      </div>
                      <div
                        className={`text-2xl font-bold ${reportData.savingsRate.rate >= 0 ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {(reportData.savingsRate.rate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Category Breakdown by Group */}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {(() => {
                  const allGroups = categories.filter((c) => !c.parentId);
                  const groupedCategories: Record<
                    string,
                    Array<{ category: string; amount: number }>
                  > = {};

                  allGroups.forEach((group) => {
                    groupedCategories[group.name] = [];
                  });

                  (reportData.allCategories || reportData.spendByCategory || []).forEach(
                    (cat: { category: string; amount: number }) => {
                      const category = categories.find((c) => c.name === cat.category);
                      const parentGroup = category?.parentId
                        ? categories.find((c) => c.id === category.parentId)
                        : null;

                      const groupName = parentGroup?.name || 'Uncategorized';
                      if (!groupedCategories[groupName]) {
                        groupedCategories[groupName] = [];
                      }
                      groupedCategories[groupName].push(cat);
                    }
                  );

                  const sortedGroups = Object.entries(groupedCategories)
                    .filter(([, cats]) => cats.length > 0)
                    .sort(([a], [b]) => {
                      if (a.toLowerCase().includes('income')) return -1;
                      if (b.toLowerCase().includes('income')) return 1;
                      return a.localeCompare(b);
                    });

                  return sortedGroups.map(([groupName, cats]) => {
                    const groupTotal = cats.reduce((sum, c) => sum + c.amount, 0);
                    const isIncome = groupName.toLowerCase().includes('income');

                    return (
                      <Card key={groupName}>
                        <CardHeader>
                          <div className="space-y-2">
                            <div className={`text-sm font-semibold ${ds.text.primary}`}>
                              {groupName}
                            </div>
                            <div
                              className={`text-2xl font-bold ${isIncome ? 'text-green-600' : 'text-red-600'}`}
                            >
                              {isIncome ? '' : '-'}
                              {formatCurrency(Math.abs(groupTotal))}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {cats.length > 0 ? (
                            <div className="space-y-2">
                              {cats
                                .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                                .map((cat) => (
                                  <div
                                    key={cat.category}
                                    className="flex items-center justify-between text-sm"
                                  >
                                    <span className={ds.text.secondary}>{cat.category}</span>
                                    <span
                                      className={`font-semibold ${cat.amount < 0 ? 'text-green-600' : cat.amount > 0 ? 'text-red-600' : ds.text.primary}`}
                                    >
                                      {formatCurrency(Math.abs(cat.amount))}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className={`text-sm ${ds.text.muted} text-center py-4`}>
                              No transactions this month
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading...</div>}>
      <ReportsContent />
    </Suspense>
  );
}
