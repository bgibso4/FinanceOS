'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
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
  const [backfillModalOpen, setBackfillModalOpen] = useState(false);
  const [backfillSaving, setBackfillSaving] = useState(false);

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

  const goToPrevMonth = () => {
    const [year, month] = trailing12EndMonth.split('-').map(Number);
    const prev = new Date(year, month - 2); // month is 1-indexed, Date expects 0-indexed
    setTrailing12EndMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  };

  const goToNextMonth = () => {
    const [year, month] = trailing12EndMonth.split('-').map(Number);
    const next = new Date(year, month); // month is 1-indexed, Date expects 0-indexed, so this is +1 month
    setTrailing12EndMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  const backfillSnapshot = async () => {
    if (!backfillForm.income || !backfillForm.spending) {
      return;
    }

    setBackfillSaving(true);
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
      setBackfillModalOpen(false);
      loadTrailing12Months(trailing12EndMonth);
    } catch (error) {
      console.error('Failed to backfill snapshot:', error);
    } finally {
      setBackfillSaving(false);
    }
  };

  const reportTabs = [
    { id: 'net-worth', label: 'Net Worth' },
    { id: 'cash-flow', label: 'Cash Flow' },
    { id: 'monthly', label: 'Monthly' },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center gap-6 text-sm font-medium mb-8 border-b border-[var(--border)] pb-2">
        {reportTabs.map((t) => (
          <Link
            key={t.id}
            className={cn(
              'pb-2 border-b-2 transition-colors',
              tab === t.id
                ? 'text-[var(--text-primary)] border-[var(--accent)]'
                : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]'
            )}
            href={`/reports?tab=${t.id}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Net Worth Tab */}
      {tab === 'net-worth' && <NetWorthSnapshots />}

      {/* Cash Flow Tab (12 Month Savings Rate) */}
      {tab === 'cash-flow' && (
        <div className="space-y-6">
          {trailing12Months.length > 0 ? (
            <>
              {/* Summary Cards */}
              {(() => {
                const count = trailing12Months.length;
                const avgIncome =
                  count > 0 ? trailing12Months.reduce((sum, m) => sum + m.income, 0) / count : 0;
                const avgSpending =
                  count > 0 ? trailing12Months.reduce((sum, m) => sum + m.spending, 0) / count : 0;
                const avgSavings =
                  count > 0 ? trailing12Months.reduce((sum, m) => sum + m.savings, 0) / count : 0;
                const avgSavingsRate =
                  count > 0
                    ? trailing12Months.reduce((sum, m) => sum + m.savingsRate, 0) / count
                    : 0;

                return (
                  <div className="grid grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                          Avg Monthly Income
                        </div>
                        <div className="text-2xl font-bold tracking-tight font-mono text-[var(--green)]">
                          {formatCurrency(avgIncome)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                          Avg Monthly Spending
                        </div>
                        <div className="text-2xl font-bold tracking-tight font-mono text-[var(--red)]">
                          {formatCurrency(avgSpending)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                          Avg Monthly Savings
                        </div>
                        <div
                          className={`text-2xl font-bold tracking-tight font-mono ${avgSavings >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                        >
                          {formatCurrency(avgSavings)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                          Avg Savings Rate
                        </div>
                        <div
                          className={`text-2xl font-bold tracking-tight font-mono ${avgSavingsRate >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                        >
                          {(avgSavingsRate * 100).toFixed(1)}%
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}

              {/* Monthly Table */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className={`text-sm font-semibold ${ds.text.primary}`}>Monthly Detail</div>
                    <div className="flex items-center gap-2">
                      <button
                        className={`p-1.5 rounded-lg transition-colors ${ds.interactive.default}`}
                        onClick={goToPrevMonth}
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
                      <span className={`text-sm ${ds.text.secondary} min-w-[140px] text-center`}>
                        {trailing12Months[0]?.label} -{' '}
                        {trailing12Months[trailing12Months.length - 1]?.label}
                      </span>
                      <button
                        className={`p-1.5 rounded-lg transition-colors ${ds.interactive.default}`}
                        onClick={goToNextMonth}
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
                      <Button
                        className="ml-4"
                        variant="outline"
                        onClick={() => setBackfillModalOpen(true)}
                      >
                        Backfill Historical
                      </Button>
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
                              className="px-3 py-2 text-right text-[var(--green)] font-semibold font-mono"
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
                              className="px-3 py-2 text-right text-[var(--red)] font-semibold font-mono"
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
                              className={`px-3 py-2 text-right font-semibold font-mono ${m.savings >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
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
                              className={`px-3 py-2 text-right font-bold font-mono ${m.savingsRate >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
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
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <div className={ds.text.muted}>Loading 12 month data...</div>
              </CardContent>
            </Card>
          )}

          {/* Backfill Historical Modal */}
          <Modal
            isOpen={backfillModalOpen}
            title="Backfill Historical Cash Flow"
            onClose={() => setBackfillModalOpen(false)}
          >
            <div className="space-y-4">
              <p className={`text-sm ${ds.text.secondary}`}>
                Manually enter historical cash flow data for months where you don&apos;t have
                individual transactions. Savings and savings rate are calculated automatically.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Year
                  </label>
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
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Month
                  </label>
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
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                  Income <span className="text-[var(--red)]">*</span>
                </label>
                <Input
                  placeholder="e.g., 5000"
                  step="0.01"
                  type="number"
                  value={backfillForm.income}
                  onChange={(e) => setBackfillForm({ ...backfillForm, income: e.target.value })}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                  Spending <span className="text-[var(--red)]">*</span>
                </label>
                <Input
                  placeholder="e.g., 3500"
                  step="0.01"
                  type="number"
                  value={backfillForm.spending}
                  onChange={(e) => setBackfillForm({ ...backfillForm, spending: e.target.value })}
                />
              </div>

              <div className={`text-xs ${ds.text.muted}`}>
                If transactions exist for this month, they will take priority over this manual
                entry.
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setBackfillModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-[var(--accent)] hover:bg-[var(--accent)] text-white"
                  disabled={backfillSaving || !backfillForm.income || !backfillForm.spending}
                  onClick={backfillSnapshot}
                >
                  {backfillSaving ? 'Saving...' : 'Save Historical Data'}
                </Button>
              </div>
            </div>
          </Modal>
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
                      <div className="text-2xl font-bold tracking-tight font-mono text-[var(--green)]">
                        {formatCurrency(reportData.netCashflow.income)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                        Cash Out
                      </div>
                      <div className="text-2xl font-bold tracking-tight font-mono text-[var(--red)]">
                        -{formatCurrency(reportData.netCashflow.spending)}
                      </div>
                    </div>
                    <div>
                      <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                        Savings Rate
                      </div>
                      <div
                        className={`text-2xl font-bold tracking-tight font-mono ${reportData.savingsRate.rate >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
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
                              className={`text-2xl font-bold tracking-tight font-mono ${isIncome ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
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
                                      className={`font-semibold font-mono ${cat.amount < 0 ? 'text-[var(--green)]' : cat.amount > 0 ? 'text-[var(--red)]' : ds.text.primary}`}
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
