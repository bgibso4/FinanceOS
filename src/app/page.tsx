'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChartRenderer } from '@/components/chart-renderer';
import { DashboardPayload, ChartSpec } from '@/lib/types';
import { loadPinned } from '@/lib/pinned';
import { ds } from '@/lib/design-system';

// Helper to format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Helper to calculate percentage change
const calcChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

// Change indicator component
const ChangeIndicator = ({
  current,
  previous,
  inverted = false,
}: {
  current: number;
  previous: number;
  inverted?: boolean;
}) => {
  const change = calcChange(current, previous);
  const isPositive = inverted ? change < 0 : change > 0;
  const isNeutral = Math.abs(change) < 1;

  if (isNeutral) {
    return <span className={`text-xs ${ds.text.muted}`}>No change</span>;
  }

  return (
    <span
      className={`text-xs font-medium font-mono ${isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
    >
      {change > 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
    </span>
  );
};

// Mini sparkline component
const Sparkline = ({ data, color = '#9a7a58' }: { data: number[]; color?: string }) => {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const height = 40;
  const width = 100;
  const padding = 4;

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = padding + (height - padding * 2) - ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x},${height - padding} L ${points[0].x},${height - padding} Z`;

  return (
    <svg className="overflow-visible opacity-55" height={height} width={width}>
      <defs>
        <linearGradient id={`sparkGradient-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#sparkGradient-${color.replace('#', '')})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      {/* End dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        fill={color}
        r="3"
      />
    </svg>
  );
};

type GoalWithProgress = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  percentage: number;
  paceStatus: 'on_track' | 'ahead' | 'behind' | null;
};

type AccountBalance = {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  balance: number;
};

type BalanceData = {
  accounts: AccountBalance[];
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
};

function DashboardPageContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [pinned, setPinned] = useState<ChartSpec[]>([]);
  const [goalsData, setGoalsData] = useState<GoalWithProgress[]>([]);

  useEffect(() => {
    const queryParams = new URLSearchParams();
    const preset = searchParams.get('preset') || 'last-3-months';
    const account = searchParams.get('account');
    const category = searchParams.get('category');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    queryParams.set('preset', preset);
    if (account) queryParams.set('account', account);
    if (category) queryParams.set('category', category);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);

    const queryString = queryParams.toString();

    Promise.all([
      fetch(`/api/analytics/dashboard${queryString ? `?${queryString}` : ''}`).then((r) =>
        r.json()
      ),
      fetch('/api/accounts/balances').then((r) => r.json()),
      fetch('/api/goals?status=active').then((r) => r.json()),
    ]).then(([dashboardData, balData, goalsRes]) => {
      setData(dashboardData);
      setBalanceData(balData);
      setGoalsData(goalsRes.goals ?? []);
    });

    const pinnedItems = loadPinned();
    setPinned(pinnedItems.map((p) => p.chartSpec));
  }, [searchParams]);

  const totalSpending = data?.spendByCategory.reduce((sum, c) => sum + c.amount, 0) ?? 0;
  const savingsSparkline = data?.incomeVsSpending.map((d) => d.income - d.spending) ?? [];
  const spendingSparkline = data?.incomeVsSpending.map((d) => d.spending) ?? [];
  const biggestExpense = data?.topMerchants[0];
  const avgDailySpend = data && data.transactionCount > 0 ? data.netCashflow.spending / 30 : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
      </div>

      {/* Net Worth Card */}
      {balanceData && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div>
                <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wide`}>
                  Net Worth
                </div>
                <div
                  className={`text-3xl font-bold font-mono tracking-tight mt-1 ${balanceData.netWorth >= 0 ? ds.text.primary : 'text-[var(--red)]'}`}
                >
                  {formatCurrency(balanceData.netWorth)}
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  <span className="text-[var(--green)] font-mono">
                    Assets: {formatCurrency(balanceData.totalAssets)}
                  </span>
                  <span className="text-[var(--red)] font-mono">
                    Liabilities: {formatCurrency(balanceData.totalLiabilities)}
                  </span>
                </div>
              </div>

              {/* Top 5 Accounts by Balance - Compact List */}
              <div className="flex-1 max-w-md">
                <div
                  className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wide mb-2`}
                >
                  Top Accounts
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {balanceData.accounts
                    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
                    .slice(0, 5)
                    .map((acc) => (
                      <div key={acc.id} className="flex items-center justify-between">
                        <span className={`${ds.text.secondary} truncate mr-2`}>{acc.name}</span>
                        <span
                          className={`font-semibold font-mono ${acc.balance >= 0 ? ds.text.primary : 'text-[var(--red)]'}`}
                        >
                          {formatCurrency(acc.balance)}
                        </span>
                      </div>
                    ))}
                  {balanceData.accounts.length > 5 && (
                    <div className="flex items-center justify-between">
                      <span className={`${ds.text.muted} text-xs italic`}>
                        +{balanceData.accounts.length - 5} more
                      </span>
                      <span />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wide`}>
                  Net Cashflow
                </div>
                <div
                  className={`text-2xl font-bold font-mono tracking-tight mt-1 ${(data?.netCashflow.savings ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {data ? formatCurrency(data.netCashflow.savings) : '—'}
                </div>
                {data && (
                  <ChangeIndicator
                    current={data.netCashflow.savings}
                    previous={data.netCashflow.prevSavings}
                  />
                )}
              </div>
              <Sparkline
                color={(data?.netCashflow.savings ?? 0) >= 0 ? '#6a9a68' : '#6a6660'}
                data={savingsSparkline}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div>
              <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wide`}>
                Income
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight mt-1 text-[var(--green)]">
                {data ? formatCurrency(data.netCashflow.income) : '—'}
              </div>
              {data && (
                <ChangeIndicator
                  current={data.netCashflow.income}
                  previous={data.netCashflow.prevIncome}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wide`}>
                  Spending
                </div>
                <div className="text-2xl font-bold font-mono tracking-tight mt-1 text-[var(--red)]">
                  {data ? formatCurrency(data.netCashflow.spending) : '—'}
                </div>
                {data && (
                  <ChangeIndicator
                    inverted
                    current={data.netCashflow.spending}
                    previous={data.netCashflow.prevSpending}
                  />
                )}
              </div>
              <Sparkline color="#6a6660" data={spendingSparkline} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div>
              <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wide`}>
                Savings Rate
              </div>
              <div
                className={`text-2xl font-bold font-mono tracking-tight mt-1 ${(data?.savingsRate.rate ?? 0) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
              >
                {data ? `${(data.savingsRate.rate * 100).toFixed(1)}%` : '—'}
              </div>
              {data && (
                <span
                  className={`text-xs font-medium font-mono ${data.savingsRate.delta >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {data.savingsRate.delta >= 0 ? '↑' : '↓'}{' '}
                  {Math.abs(data.savingsRate.delta * 100).toFixed(1)}pp
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className={`text-xs ${ds.text.muted}`}>Transactions</div>
            <div className={`text-xl font-bold font-mono ${ds.text.primary}`}>
              {data?.transactionCount ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className={`text-xs ${ds.text.muted}`}>Avg Daily Spend</div>
            <div className={`text-xl font-bold font-mono ${ds.text.primary}`}>
              {formatCurrency(avgDailySpend)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className={`text-xs ${ds.text.muted}`}>Top Merchant</div>
            <div className={`text-xl font-bold ${ds.text.primary} truncate`}>
              {biggestExpense?.merchant ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className={`text-xs ${ds.text.muted}`}>3-Mo Savings Avg</div>
            <div className={`text-xl font-bold font-mono ${ds.text.primary}`}>
              {data ? `${(data.savingsRate.rollingAvg * 100).toFixed(1)}%` : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Income vs Spending</div>
          </CardHeader>
          <CardContent className="h-64">
            {data && (
              <ChartRenderer
                spec={{
                  type: 'area',
                  title: '',
                  series: [
                    {
                      label: 'Income',
                      data: data.incomeVsSpending.map((d) => ({ x: d.month, y: d.income })),
                    },
                    {
                      label: 'Spending',
                      data: data.incomeVsSpending.map((d) => ({ x: d.month, y: d.spending })),
                    },
                  ],
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className={`text-sm font-semibold ${ds.text.secondary}`}>
                Spending by Category
              </div>
              <a
                className="text-xs text-[var(--accent)] hover:opacity-80 font-medium"
                href="/analytics"
              >
                Details →
              </a>
            </div>
          </CardHeader>
          <CardContent className="h-64">
            {data && (
              <ChartRenderer
                spec={{
                  type: 'pie',
                  title: '',
                  series: [
                    {
                      label: 'Spend',
                      data: data.spendByCategory
                        .slice(0, 6)
                        .map((c) => ({ x: c.category, y: c.amount })),
                    },
                  ],
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Top Categories</div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.spendByCategory ?? []).slice(0, 5).map((cat) => {
                const percentage = totalSpending > 0 ? (cat.amount / totalSpending) * 100 : 0;
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${ds.text.secondary} truncate`}>
                        {cat.category}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold font-mono ${ds.text.primary}`}>
                          {formatCurrency(cat.amount)}
                        </span>
                        {cat.monthOverMonth !== 0 && (
                          <span
                            className={`text-xs font-mono ${cat.monthOverMonth > 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}
                          >
                            {cat.monthOverMonth > 0 ? '↑' : '↓'}
                            {Math.abs(cat.monthOverMonth).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`h-1.5 ${ds.bg.tertiary} rounded-full overflow-hidden`}>
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Top Merchants</div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.topMerchants ?? []).slice(0, 5).map((m, idx) => (
                <div key={m.merchant} className="flex items-center gap-2">
                  <div
                    className={`w-5 h-5 rounded-full ${ds.bg.tertiary} flex items-center justify-center text-xs font-medium ${ds.text.muted}`}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${ds.text.secondary} truncate block`}>
                      {m.merchant}
                    </span>
                  </div>
                  <div className={`text-sm font-semibold font-mono ${ds.text.primary}`}>
                    {formatCurrency(m.amount)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Notable Changes</div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.trendAlerts ?? []).slice(0, 5).map((alert) => {
                const isIncrease = alert.deltaAmount > 0;
                return (
                  <div key={alert.title} className="flex items-center justify-between py-1">
                    <span className={`text-sm ${ds.text.secondary} truncate`}>
                      {alert.title.replace(' change', '')}
                    </span>
                    <span
                      className={`text-sm font-medium font-mono ${isIncrease ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}
                    >
                      {isIncrease ? '+' : ''}
                      {formatCurrency(alert.deltaAmount)}
                    </span>
                  </div>
                );
              })}
              {!data && <div className={`${ds.text.muted} text-sm`}>Loading...</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Goals */}
      {goalsData.length > 0 && (
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Goals</div>
            <a className="text-xs text-[var(--accent)] hover:opacity-80 font-medium" href="/goals">
              View All →
            </a>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {goalsData.slice(0, 4).map((goal) => {
                const barColor =
                  goal.paceStatus === 'ahead'
                    ? 'bg-[var(--green)]'
                    : goal.paceStatus === 'behind'
                      ? 'bg-[var(--red)]'
                      : 'bg-[var(--accent)]';
                return (
                  <div key={goal.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${ds.text.secondary} truncate`}>
                        {goal.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold font-mono ${ds.text.primary}`}>
                          {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                        </span>
                        <span className={`text-xs font-mono ${ds.text.muted}`}>
                          {goal.percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <div className={`h-1.5 ${ds.bg.tertiary} rounded-full overflow-hidden`}>
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${Math.min(goal.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pinned Insights */}
      {pinned.length > 0 && (
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.secondary}`}>Pinned Insights</div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pinned.map((spec, idx) => (
                <div key={idx} className="h-64">
                  <ChartRenderer spec={spec} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading dashboard...</div>}>
      <DashboardPageContent />
    </Suspense>
  );
}
