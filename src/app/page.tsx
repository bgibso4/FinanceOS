'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChartRenderer } from '@/components/chart-renderer';
import { FilterRibbon } from '@/components/filter-ribbon';
import { DashboardPayload, ChartSpec } from '@/lib/types';
import { loadPinned } from '@/lib/pinned';
import { ds } from '@/lib/design-system';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const calcChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const ChangeIndicator = ({
  current,
  previous,
  inverted = false,
  suffix = '%',
}: {
  current: number;
  previous: number;
  inverted?: boolean;
  suffix?: string;
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
      {change > 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}
      {suffix}
    </span>
  );
};

const Sparkline = ({ data, color = '#9a7a58' }: { data: number[]; color?: string }) => {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const height = 32;
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
    const preset = searchParams.get('preset') || 'last-12-months';
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

  const incomeSparkline = data?.incomeVsSpending.map((d) => d.income) ?? [];
  const spendingSparkline = data?.incomeVsSpending.map((d) => d.spending) ?? [];
  const savingsRateSparkline =
    data?.incomeVsSpending.map((d) => (d.income > 0 ? (d.income - d.spending) / d.income : 0)) ??
    [];
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
      </div>

      <Suspense fallback={<div className="h-12" />}>
        <FilterRibbon />
      </Suspense>

      {/* Joined Metric Strip */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-xl overflow-hidden"
        style={{ background: 'var(--border)' }}
      >
        {/* Net Worth */}
        <div className="bg-[var(--bg-card)] p-7 transition-colors hover:bg-[var(--bg-elevated)]">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.8px] mb-3.5">
                Net Worth
              </div>
              <div className="text-[28px] font-mono font-medium tracking-tight leading-none text-[var(--accent)]">
                {balanceData ? formatCurrency(balanceData.netWorth) : '—'}
              </div>
              <div className="mt-2">
                {balanceData && data && (
                  <ChangeIndicator
                    current={data.netCashflow.savings}
                    previous={data.netCashflow.prevSavings}
                  />
                )}
              </div>
            </div>
            <Sparkline color="var(--accent)" data={incomeSparkline} />
          </div>
        </div>

        {/* Income */}
        <div className="bg-[var(--bg-card)] p-7 transition-colors hover:bg-[var(--bg-elevated)]">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.8px] mb-3.5">
                Income
              </div>
              <div className="text-[28px] font-mono font-medium tracking-tight leading-none text-[var(--text-primary)]">
                {data ? formatCurrency(data.netCashflow.income) : '—'}
              </div>
              <div className="mt-2">
                {data && (
                  <ChangeIndicator
                    current={data.netCashflow.income}
                    previous={data.netCashflow.prevIncome}
                  />
                )}
              </div>
            </div>
            <Sparkline color="var(--text-muted)" data={incomeSparkline} />
          </div>
        </div>

        {/* Expenses */}
        <div className="bg-[var(--bg-card)] p-7 transition-colors hover:bg-[var(--bg-elevated)]">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.8px] mb-3.5">
                Expenses
              </div>
              <div className="text-[28px] font-mono font-medium tracking-tight leading-none text-[var(--text-primary)]">
                {data ? formatCurrency(data.netCashflow.spending) : '—'}
              </div>
              <div className="mt-2">
                {data && (
                  <ChangeIndicator
                    inverted
                    current={data.netCashflow.spending}
                    previous={data.netCashflow.prevSpending}
                  />
                )}
              </div>
            </div>
            <Sparkline color="var(--text-muted)" data={spendingSparkline} />
          </div>
        </div>

        {/* Savings Rate */}
        <div className="bg-[var(--bg-card)] p-7 transition-colors hover:bg-[var(--bg-elevated)]">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.8px] mb-3.5">
                Savings Rate
              </div>
              <div className="text-[28px] font-mono font-medium tracking-tight leading-none text-[var(--text-primary)]">
                {data ? `${(data.savingsRate.rate * 100).toFixed(1)}%` : '—'}
              </div>
              <div className="mt-2">
                {data && (
                  <span
                    className={`text-xs font-medium font-mono ${data.savingsRate.delta >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                  >
                    {data.savingsRate.delta >= 0 ? '↑' : '↓'}{' '}
                    {Math.abs(data.savingsRate.delta * 100).toFixed(1)}pp
                  </span>
                )}
              </div>
            </div>
            <Sparkline color="var(--text-muted)" data={savingsRateSparkline} />
          </div>
        </div>
      </div>

      {/* Two-column content area */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Cash Flow Chart */}
          <Card>
            <CardHeader>
              <div className="text-sm font-semibold text-[var(--text-primary)]">Cash Flow</div>
              <a
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-medium transition-colors"
                href="/analytics"
              >
                View Details
              </a>
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

          {/* Goals Card */}
          {goalsData.length > 0 && (
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Goals</div>
                <a
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-medium transition-colors"
                  href="/goals"
                >
                  View All
                </a>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {goalsData.slice(0, 3).map((goal) => {
                    const barColor =
                      goal.paceStatus === 'ahead'
                        ? 'bg-[var(--green)]'
                        : goal.paceStatus === 'behind'
                          ? 'bg-[var(--red)]'
                          : 'bg-[var(--accent)]';
                    return (
                      <div key={goal.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-[var(--text-secondary)] truncate">
                            {goal.name}
                          </span>
                          <span className="text-xs font-mono text-[var(--text-muted)] ml-2">
                            {goal.percentage.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-[var(--track-bg)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${Math.min(goal.percentage, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs font-mono text-[var(--text-muted)]">
                            {formatCurrency(goal.currentAmount)}
                          </span>
                          <span className="text-xs font-mono text-[var(--text-muted)]">
                            {formatCurrency(goal.targetAmount)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Accounts Card */}
          {balanceData && (
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Accounts</div>
                <a
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-medium transition-colors"
                  href="/settings?tab=accounts"
                >
                  View All
                </a>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5">
                  {balanceData.accounts
                    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
                    .slice(0, 10)
                    .map((acc) => (
                      <div key={acc.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-[var(--text-muted)] shrink-0" />
                          <span className="text-sm text-[var(--text-secondary)] truncate">
                            {acc.name}
                          </span>
                        </div>
                        <span
                          className={`text-sm font-semibold font-mono ml-3 ${acc.balance >= 0 ? 'text-[var(--text-primary)]' : 'text-[var(--red)]'}`}
                        >
                          {formatCurrency(acc.balance)}
                        </span>
                      </div>
                    ))}
                </div>
                {balanceData.accounts.length > 10 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <a
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] font-medium transition-colors"
                      href="/settings?tab=accounts"
                    >
                      +{balanceData.accounts.length - 10} more accounts
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Pinned Insights */}
      {pinned.length > 0 && (
        <Card>
          <CardHeader>
            <div className="text-sm font-semibold text-[var(--text-primary)]">Pinned Insights</div>
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
