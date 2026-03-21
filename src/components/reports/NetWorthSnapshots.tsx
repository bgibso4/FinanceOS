'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { ds } from '@/lib/design-system';
import { parseInflationRates, adjustSnapshotsForInflation } from '@/lib/inflation';
import { FORECAST_STRATEGIES, getStrategy } from '@/lib/forecasting';
import type { InflationRateEntry } from '@/lib/inflation';
import type { ForecastDataPoint } from '@/lib/forecasting';

// Account type groupings for breakdown display
const ASSET_GROUPS: Record<string, { label: string; types: string[]; color: string }> = {
  cash_banking: {
    label: 'Cash & Banking',
    types: ['checking', 'savings', 'cash'],
    color: '#3b82f6',
  },
  investments: { label: 'Investments', types: ['brokerage', 'retirement'], color: '#8b5cf6' },
  crypto: { label: 'Crypto', types: ['crypto'], color: '#f59e0b' },
  other: { label: 'Other', types: ['other'], color: '#6b7280' },
};

const LIABILITY_GROUPS: Record<string, { label: string; types: string[]; color: string }> = {
  credit: { label: 'Credit Cards', types: ['credit'], color: '#ef4444' },
  loans: { label: 'Loans', types: ['loan'], color: '#f97316' },
};

// Helper to group accounts by type category
function groupAccountsByType(
  accounts: Record<string, AccountBalance>,
  groups: Record<string, { label: string; types: string[]; color: string }>,
  isAsset: boolean
): {
  groupKey: string;
  label: string;
  color: string;
  total: number;
  accounts: Array<{ id: string; acc: AccountBalance }>;
}[] {
  const result: {
    groupKey: string;
    label: string;
    color: string;
    total: number;
    accounts: Array<{ id: string; acc: AccountBalance }>;
  }[] = [];

  for (const [groupKey, group] of Object.entries(groups)) {
    const groupAccounts: Array<{ id: string; acc: AccountBalance }> = [];
    let total = 0;

    for (const [accountId, acc] of Object.entries(accounts)) {
      const accountIsAsset = !['credit', 'loan'].includes(acc.type);
      if (accountIsAsset === isAsset && group.types.includes(acc.type)) {
        groupAccounts.push({ id: accountId, acc });
        total += Math.abs(acc.balance);
      }
    }

    if (groupAccounts.length > 0) {
      // Sort accounts by balance descending
      groupAccounts.sort((a, b) => Math.abs(b.acc.balance) - Math.abs(a.acc.balance));
      result.push({
        groupKey,
        label: group.label,
        color: group.color,
        total,
        accounts: groupAccounts,
      });
    }
  }

  // Sort groups by total descending
  result.sort((a, b) => b.total - a.total);
  return result;
}

type AccountBalance = {
  balance: number;
  name: string;
  type: string;
  currency: string;
};

type NetWorthSnapshot = {
  id: string;
  date: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  accountBalances: Record<string, AccountBalance>;
  period: string | null;
  notes: string | null;
  isAutomatic: boolean;
  createdAt: string;
};

type ComparisonResult = {
  snapshot1: {
    id: string;
    date: string;
    period: string | null;
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
  };
  snapshot2: {
    id: string;
    date: string;
    period: string | null;
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
  };
  comparison: {
    netWorthChange: number;
    netWorthChangePercent: number;
    assetsChange: number;
    assetsChangePercent: number;
    liabilitiesChange: number;
    liabilitiesChangePercent: number;
    accountChanges: Array<{
      accountId: string;
      name: string;
      type: string;
      balance1: number;
      balance2: number;
      change: number;
      changePercent: number;
    }>;
  };
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatPercent = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
};

const formatCompactCurrency = (amount: number) => {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const formatShortDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

// Projection chart: historical solid line + projected dashed line
function ForecastChart({
  snapshots,
  projections,
}: {
  snapshots: NetWorthSnapshot[];
  projections: Array<{ monthsOut: number; date: string; projectedNetWorth: number }>;
}) {
  if (snapshots.length < 2 || projections.length === 0) return null;

  // Build data: historical (chronological) + projected
  const historical = [...snapshots].reverse().slice(-12);
  const allValues = [
    ...historical.map((s) => s.netWorth),
    ...projections.map((p) => p.projectedNetWorth),
  ];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const width = 600;
  const height = 100;
  const paddingLeft = 35;
  const paddingRight = 10;
  const paddingTop = 14;
  const paddingBottom = 14;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const totalPoints = historical.length + projections.length;

  const toX = (i: number) => paddingLeft + (i / (totalPoints - 1)) * chartWidth;
  const toY = (v: number) => paddingTop + chartHeight - ((v - min) / range) * chartHeight;

  // Y-axis gridlines (4 lines)
  const gridLineCount = 4;
  const gridLines = Array.from({ length: gridLineCount }, (_, i) => {
    const value = min + (range * (i + 1)) / (gridLineCount + 1);
    return { y: toY(value), value };
  });

  // Historical points
  const histPoints = historical.map((s, i) => ({
    x: toX(i),
    y: toY(s.netWorth),
    value: s.netWorth,
    label: formatShortDate(s.date),
  }));

  // Projected points (continue after historical)
  const projPoints = projections.map((p, i) => ({
    x: toX(historical.length + i),
    y: toY(p.projectedNetWorth),
    value: p.projectedNetWorth,
    label: `+${p.monthsOut}mo`,
  }));

  const histPath = histPoints
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ');

  // Dashed line from last historical point through projections
  const lastHist = histPoints[histPoints.length - 1];
  const projPath = [lastHist, ...projPoints]
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ');

  // Gradient area for historical
  const histArea = `${histPath} L ${lastHist.x} ${height - paddingBottom} L ${histPoints[0].x} ${height - paddingBottom} Z`;

  return (
    <div className="w-full overflow-hidden">
      <svg className="w-full block" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="forecastHistGradient" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines */}
        {gridLines.map((gl, i) => (
          <g key={`grid-${i}`}>
            <line
              stroke="#374151"
              strokeDasharray="2 2"
              strokeWidth="0.3"
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={gl.y}
              y2={gl.y}
            />
            <text
              className="text-[3px]"
              dominantBaseline="middle"
              fill="#6b7280"
              textAnchor="end"
              x={paddingLeft - 2}
              y={gl.y}
            >
              {formatCompactCurrency(gl.value)}
            </text>
          </g>
        ))}

        {/* Historical gradient area */}
        <path d={histArea} fill="url(#forecastHistGradient)" />

        {/* Historical solid line */}
        <path
          d={histPath}
          fill="none"
          stroke="#3b82f6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="0.75"
        />

        {/* Projected dashed line */}
        <path
          d={projPath}
          fill="none"
          stroke="#8b5cf6"
          strokeDasharray="3 2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="0.75"
        />

        {/* Divider line at "now" */}
        <line
          stroke="#9ca3af"
          strokeDasharray="2 2"
          strokeWidth="0.5"
          x1={lastHist.x}
          x2={lastHist.x}
          y1={paddingTop}
          y2={height - paddingBottom}
        />
        <text
          className="text-[3.5px] font-medium"
          fill="#9ca3af"
          textAnchor="middle"
          x={lastHist.x}
          y={paddingTop - 2}
        >
          Now
        </text>

        {/* Historical dots */}
        {histPoints.map((p, i) => (
          <circle key={`h-${i}`} cx={p.x} cy={p.y} fill="#3b82f6" r="1" />
        ))}

        {/* Projected dots with labels */}
        {projPoints.map((p, i) => (
          <g key={`p-${i}`}>
            <circle cx={p.x} cy={p.y} fill="#8b5cf6" r="1.5" />
            <text
              className="text-[3.5px] font-medium"
              fill="#8b5cf6"
              textAnchor="middle"
              x={p.x}
              y={p.y - 3}
            >
              {formatCurrency(p.value)}
            </text>
            <text
              className="text-[3px]"
              fill="#9ca3af"
              textAnchor="middle"
              x={p.x}
              y={height - paddingBottom + 5}
            >
              {p.label}
            </text>
          </g>
        ))}

        {/* X-axis labels for first and last historical */}
        <text
          className="text-[3px]"
          fill="#9ca3af"
          textAnchor="start"
          x={histPoints[0].x}
          y={height - paddingBottom + 5}
        >
          {histPoints[0].label}
        </text>
        <text
          className="text-[3px]"
          fill="#9ca3af"
          textAnchor="middle"
          x={lastHist.x}
          y={height - paddingBottom + 5}
        >
          {lastHist.label}
        </text>
      </svg>
      <div className="flex items-center justify-center gap-4 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-[var(--accent)] rounded" />
          <span className={`text-[10px] ${ds.text.muted}`}>Historical</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-0.5 rounded"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to right, #8b5cf6 0, #8b5cf6 3px, transparent 3px, transparent 5px)',
            }}
          />
          <span className={`text-[10px] ${ds.text.muted}`}>Projected</span>
        </div>
      </div>
    </div>
  );
}

// Simple SVG line chart component for net worth trend
function NetWorthTrendChart({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  if (snapshots.length < 2) return null;

  // Reverse to show chronological order (oldest first)
  const data = [...snapshots].reverse().slice(-12); // Last 12 snapshots
  const values = data.map((s) => s.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const width = 100;
  const height = 60;
  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Create points for the line
  const points = data.map((s, i) => {
    const x = padding + (i / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((s.netWorth - min) / range) * chartHeight;
    return { x, y, snapshot: s };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');

  // Create gradient area
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`;

  const latestValue = values[values.length - 1];
  const startValue = values[0];
  const change = latestValue - startValue;
  const changePercent = startValue !== 0 ? (change / Math.abs(startValue)) * 100 : 0;
  const isPositive = change >= 0;

  return (
    <div className="flex items-center gap-4">
      <svg
        className="w-full max-w-[200px] h-[60px]"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id="netWorthGradient" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#netWorthGradient)" />
        <path
          d={pathD}
          fill="none"
          stroke={isPositive ? '#22c55e' : '#ef4444'}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        {/* End point dot */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          fill={isPositive ? '#22c55e' : '#ef4444'}
          r="3"
        />
      </svg>
      <div className="text-right shrink-0">
        <div
          className={`text-sm font-semibold ${isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
        >
          {isPositive ? '+' : ''}
          {formatCurrency(change)}
        </div>
        <div className={`text-xs ${isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
          {formatPercent(changePercent)}
        </div>
        <div className={`text-xs ${ds.text.muted}`}>
          {formatShortDate(data[0].date)} - {formatShortDate(data[data.length - 1].date)}
        </div>
      </div>
    </div>
  );
}

// Horizontal bar chart component for breakdown visualization
function BreakdownBarChart({
  groups,
  total,
}: {
  groups: { label: string; color: string; total: number }[];
  total: number;
}) {
  if (total === 0) return null;

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="h-3 rounded-full overflow-hidden flex bg-[var(--bg-elevated)]">
        {groups.map((group, i) => {
          const percentage = (group.total / total) * 100;
          if (percentage < 1) return null;
          return (
            <div
              key={i}
              className="h-full transition-all duration-300"
              style={{ width: `${percentage}%`, backgroundColor: group.color }}
              title={`${group.label}: ${formatCurrency(group.total)} (${percentage.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {groups.map((group, i) => {
          const percentage = (group.total / total) * 100;
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: group.color }}
              />
              <span className={ds.text.secondary}>
                {group.label}: {percentage.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NetWorthSnapshots() {
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureModalOpen, setCaptureModalOpen] = useState(false);
  const [captureForm, setCaptureForm] = useState({ period: '', notes: '' });
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<NetWorthSnapshot | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [backfillModalOpen, setBackfillModalOpen] = useState(false);
  const [backfillForm, setBackfillForm] = useState({
    date: '',
    netWorth: '',
    totalAssets: '',
    totalLiabilities: '',
    period: '',
    notes: '',
  });
  const [backfillSaving, setBackfillSaving] = useState(false);

  // Inflation & forecasting state
  const [inflationRates, setInflationRates] = useState<InflationRateEntry[]>([]);
  const [showInflationAdjusted, setShowInflationAdjusted] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<string>(FORECAST_STRATEGIES[0].name);

  useEffect(() => {
    loadSnapshots();
  }, []);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const [snapshotsRes, inflationRes] = await Promise.all([
        fetch('/api/snapshots?limit=20'),
        fetch('/api/inflation-rates'),
      ]);
      const snapshotsData = await snapshotsRes.json();
      const inflationData = await inflationRes.json();
      setSnapshots(snapshotsData.snapshots || []);
      setInflationRates(inflationData.rates || []);
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    } finally {
      setLoading(false);
    }
  };

  // Compute inflation-adjusted snapshots
  const inflationRateMap = useMemo(() => parseInflationRates(inflationRates), [inflationRates]);
  const hasInflationRates = inflationRates.length > 0;

  const adjustedSnapshots = useMemo(() => {
    if (!showInflationAdjusted || !hasInflationRates || snapshots.length === 0) return null;
    const toYear = new Date().getFullYear();
    return adjustSnapshotsForInflation(snapshots, toYear, inflationRateMap);
  }, [snapshots, showInflationAdjusted, hasInflationRates, inflationRateMap]);

  // Compute forecast projections
  const forecastResult = useMemo(() => {
    if (snapshots.length < 2) return null;
    const strategy = getStrategy(selectedStrategy);
    const dataPoints: ForecastDataPoint[] = snapshots.map((s) => ({
      date: s.date,
      netWorth: s.netWorth,
    }));
    return strategy.forecast(dataPoints, [6, 12, 24]);
  }, [snapshots, selectedStrategy]);

  const captureSnapshot = async () => {
    setCapturing(true);
    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: captureForm.period || undefined,
          notes: captureForm.notes || undefined,
        }),
      });
      if (res.ok) {
        setCaptureModalOpen(false);
        setCaptureForm({ period: '', notes: '' });
        loadSnapshots();
      }
    } catch (error) {
      console.error('Failed to capture snapshot:', error);
    } finally {
      setCapturing(false);
    }
  };

  const deleteSnapshot = async (id: string) => {
    if (!confirm('Are you sure you want to delete this snapshot?')) return;
    try {
      await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
      loadSnapshots();
      setDetailModalOpen(false);
    } catch (error) {
      console.error('Failed to delete snapshot:', error);
    }
  };

  const saveBackfillSnapshot = async () => {
    if (!backfillForm.date || !backfillForm.netWorth) return;

    setBackfillSaving(true);
    try {
      const netWorth = parseFloat(backfillForm.netWorth.replace(/,/g, ''));
      const totalAssets = backfillForm.totalAssets
        ? parseFloat(backfillForm.totalAssets.replace(/,/g, ''))
        : undefined;
      const totalLiabilities = backfillForm.totalLiabilities
        ? parseFloat(backfillForm.totalLiabilities.replace(/,/g, ''))
        : undefined;

      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: backfillForm.date,
          period: backfillForm.period || undefined,
          notes: backfillForm.notes || undefined,
          manual: {
            netWorth,
            totalAssets,
            totalLiabilities,
          },
        }),
      });

      if (res.ok) {
        setBackfillModalOpen(false);
        setBackfillForm({
          date: '',
          netWorth: '',
          totalAssets: '',
          totalLiabilities: '',
          period: '',
          notes: '',
        });
        loadSnapshots();
      }
    } catch (error) {
      console.error('Failed to save backfill snapshot:', error);
    } finally {
      setBackfillSaving(false);
    }
  };

  const openDetail = (snapshot: NetWorthSnapshot) => {
    setSelectedSnapshot(snapshot);
    setDetailModalOpen(true);
  };

  const toggleCompareSelection = (id: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(id)) {
        return prev.filter((s) => s !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id]; // Keep last selected, add new one
      }
      return [...prev, id];
    });
  };

  const runComparison = async () => {
    if (compareSelection.length !== 2) return;
    try {
      const res = await fetch(
        `/api/snapshots/compare?snapshot1=${compareSelection[0]}&snapshot2=${compareSelection[1]}`
      );
      const data = await res.json();
      setComparison(data);
      setCompareModalOpen(true);
    } catch (error) {
      console.error('Failed to compare snapshots:', error);
    }
  };

  // Get period suggestions (current quarter, current month)
  const getPeriodSuggestions = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    return [`${year}-Q${quarter}`, `${year}-${String(month).padStart(2, '0')}`];
  };

  const latestSnapshot = snapshots[0];
  const previousSnapshot = snapshots[1];

  // Calculate change from previous snapshot
  const netWorthChange =
    latestSnapshot && previousSnapshot ? latestSnapshot.netWorth - previousSnapshot.netWorth : null;
  const netWorthChangePercent =
    latestSnapshot && previousSnapshot && previousSnapshot.netWorth !== 0
      ? ((latestSnapshot.netWorth - previousSnapshot.netWorth) /
          Math.abs(previousSnapshot.netWorth)) *
        100
      : null;

  return (
    <div className="space-y-4">
      {/* Current Net Worth Card - Improved Design */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Net Worth Tracking</div>
            <div className="flex items-center gap-2 shrink-0">
              {hasInflationRates && (
                <Button
                  className={
                    showInflationAdjusted ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''
                  }
                  variant={showInflationAdjusted ? 'primary' : 'outline'}
                  onClick={() => setShowInflationAdjusted(!showInflationAdjusted)}
                >
                  {showInflationAdjusted ? 'Nominal' : 'Inflation-Adjusted'}
                </Button>
              )}
              {snapshots.length >= 2 && (
                <Button
                  className={compareMode ? 'bg-[var(--accent)] hover:opacity-90 text-white' : ''}
                  variant={compareMode ? 'primary' : 'outline'}
                  onClick={() => {
                    setCompareMode(!compareMode);
                    setCompareSelection([]);
                  }}
                >
                  {compareMode ? 'Exit Compare' : 'Compare'}
                </Button>
              )}
              <Button variant="outline" onClick={() => setBackfillModalOpen(true)}>
                Backfill Historical
              </Button>
              <Button
                className="bg-[var(--accent)] hover:opacity-90 text-white"
                onClick={() => setCaptureModalOpen(true)}
              >
                Capture Snapshot
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {latestSnapshot ? (
            <div className="space-y-6">
              {/* Main Net Worth Display */}
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1">
                  <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                    Current Net Worth
                    {showInflationAdjusted && (
                      <span className="ml-1 text-amber-600">
                        (in {new Date().getFullYear()} dollars)
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <div
                      className={`text-4xl font-bold font-mono ${latestSnapshot.netWorth >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                    >
                      {formatCurrency(
                        showInflationAdjusted && adjustedSnapshots
                          ? adjustedSnapshots[0].adjustedNetWorth
                          : latestSnapshot.netWorth
                      )}
                    </div>
                    {netWorthChange !== null && (
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-sm font-medium ${netWorthChange >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                        >
                          {netWorthChange >= 0 ? '↑' : '↓'}{' '}
                          {formatCurrency(Math.abs(netWorthChange))}
                        </span>
                        {netWorthChangePercent !== null && (
                          <span className={`text-xs ${ds.text.muted}`}>
                            ({formatPercent(netWorthChangePercent)})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={`text-sm ${ds.text.secondary} mt-1`}>
                    as of {formatDate(latestSnapshot.date)}
                    {latestSnapshot.period && ` (${latestSnapshot.period})`}
                  </div>
                </div>

                {/* Trend Chart */}
                {snapshots.length >= 2 && (
                  <div className="shrink-0">
                    <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-2`}>
                      Trend
                    </div>
                    <NetWorthTrendChart snapshots={snapshots} />
                  </div>
                )}
              </div>

              {/* Assets & Liabilities Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 rounded-lg border ${ds.border.default} ${ds.bg.secondary}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-xs ${ds.text.muted} uppercase tracking-wide`}>
                      Total Assets
                    </div>
                    <div className="text-xl font-bold text-[var(--green)]">
                      {formatCurrency(latestSnapshot.totalAssets)}
                    </div>
                  </div>
                  {/* Mini breakdown bar for assets */}
                  {(() => {
                    const assetGroups = groupAccountsByType(
                      latestSnapshot.accountBalances,
                      ASSET_GROUPS,
                      true
                    );
                    return (
                      <BreakdownBarChart groups={assetGroups} total={latestSnapshot.totalAssets} />
                    );
                  })()}
                </div>
                <div className={`p-4 rounded-lg border ${ds.border.default} ${ds.bg.secondary}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-xs ${ds.text.muted} uppercase tracking-wide`}>
                      Total Liabilities
                    </div>
                    <div className="text-xl font-bold text-[var(--red)]">
                      {formatCurrency(latestSnapshot.totalLiabilities)}
                    </div>
                  </div>
                  {/* Mini breakdown bar for liabilities */}
                  {(() => {
                    const liabilityGroups = groupAccountsByType(
                      latestSnapshot.accountBalances,
                      LIABILITY_GROUPS,
                      false
                    );
                    return (
                      <BreakdownBarChart
                        groups={liabilityGroups}
                        total={latestSnapshot.totalLiabilities}
                      />
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div className={`text-center py-8 ${ds.text.muted}`}>
              <p className="mb-4">
                No snapshots yet. Capture your first net worth snapshot to start tracking.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Net Worth Projections */}
      {forecastResult && snapshots.length >= 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className={`text-sm font-semibold ${ds.text.primary}`}>
                Net Worth Projections
              </div>
              {FORECAST_STRATEGIES.length > 1 && (
                <Select
                  className="text-xs"
                  value={selectedStrategy}
                  onChange={(e) => setSelectedStrategy(e.target.value)}
                >
                  {FORECAST_STRATEGIES.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              {/* Left: projection cards stacked vertically */}
              <div className="flex flex-col gap-2.5 w-44 shrink-0">
                {forecastResult.projections.map((p) => {
                  const currentNetWorth = snapshots[0].netWorth;
                  const projectedChange = p.projectedNetWorth - currentNetWorth;
                  const isPositive = projectedChange >= 0;

                  return (
                    <div
                      key={p.monthsOut}
                      className={`p-3 rounded-lg border ${ds.border.default} ${ds.bg.secondary}`}
                    >
                      <div className={`text-[11px] ${ds.text.muted} uppercase tracking-wide`}>
                        {p.monthsOut} months
                      </div>
                      <div className={`text-base font-bold ${ds.text.primary}`}>
                        {formatCurrency(p.projectedNetWorth)}
                      </div>
                      <div
                        className={`text-xs font-medium ${isPositive ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                      >
                        {isPositive ? '+' : ''}
                        {formatCurrency(projectedChange)}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Right: projection chart */}
              <div
                className={`flex-1 min-w-0 p-2 rounded-lg border ${ds.border.default} ${ds.bg.primary}`}
              >
                <ForecastChart projections={forecastResult.projections} snapshots={snapshots} />
              </div>
            </div>

            {forecastResult.metadata.avgMonthlyChange !== undefined && (
              <div className={`text-xs ${ds.text.muted} mt-3`}>
                Based on avg. monthly change of{' '}
                <span className="font-mono font-medium">
                  {formatCurrency(forecastResult.metadata.avgMonthlyChange)}
                </span>{' '}
                across {forecastResult.metadata.inputDataPoints} snapshots.{' '}
                {forecastResult.metadata.description}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Snapshot History */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className={`text-sm font-semibold ${ds.text.primary}`}>Snapshot History</div>
              {compareMode && compareSelection.length === 2 && (
                <Button
                  className="bg-[var(--accent)] hover:opacity-90 text-white shrink-0"
                  onClick={runComparison}
                >
                  Compare Selected
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className={`text-center py-4 ${ds.text.muted}`}>Loading...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={ds.bg.tertiary}>
                    <tr>
                      {compareMode && (
                        <th
                          className={`px-3 py-2 text-left ${ds.text.secondary} font-semibold w-10`}
                        >
                          Select
                        </th>
                      )}
                      <th className={`px-3 py-2 text-left ${ds.text.secondary} font-semibold`}>
                        Date
                      </th>
                      <th className={`px-3 py-2 text-left ${ds.text.secondary} font-semibold`}>
                        Period
                      </th>
                      <th className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold`}>
                        Net Worth
                      </th>
                      {showInflationAdjusted && adjustedSnapshots && (
                        <th className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold`}>
                          Adjusted
                        </th>
                      )}
                      <th className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold`}>
                        Assets
                      </th>
                      <th className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold`}>
                        Liabilities
                      </th>
                      <th className={`px-3 py-2 text-right ${ds.text.secondary} font-semibold`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${ds.border.default}`}>
                    {snapshots.map((snapshot, idx) => {
                      const prevSnapshot = snapshots[idx + 1];
                      const change = prevSnapshot
                        ? snapshot.netWorth - prevSnapshot.netWorth
                        : null;
                      const isSelected = compareSelection.includes(snapshot.id);

                      return (
                        <tr
                          key={snapshot.id}
                          className={`hover:${ds.bg.secondary} ${isSelected ? 'bg-[var(--accent)]/10' : ''}`}
                        >
                          {compareMode && (
                            <td className="px-3 py-2">
                              <input
                                checked={isSelected}
                                className="w-4 h-4 rounded"
                                type="checkbox"
                                onChange={() => toggleCompareSelection(snapshot.id)}
                              />
                            </td>
                          )}
                          <td className={`px-3 py-2 ${ds.text.primary}`}>
                            {formatDate(snapshot.date)}
                          </td>
                          <td className={`px-3 py-2 ${ds.text.secondary}`}>
                            {snapshot.period || '-'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span
                              className={`font-semibold ${snapshot.netWorth >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                            >
                              {formatCurrency(snapshot.netWorth)}
                            </span>
                            {change !== null && (
                              <span
                                className={`ml-2 text-xs ${change >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                              >
                                {change >= 0 ? '+' : ''}
                                {formatCurrency(change)}
                              </span>
                            )}
                          </td>
                          {showInflationAdjusted && adjustedSnapshots && (
                            <td className="px-3 py-2 text-right">
                              <span className="font-medium text-amber-600">
                                {formatCurrency(adjustedSnapshots[idx].adjustedNetWorth)}
                              </span>
                            </td>
                          )}
                          <td className="px-3 py-2 text-right text-[var(--green)]">
                            {formatCurrency(snapshot.totalAssets)}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--red)]">
                            {formatCurrency(snapshot.totalLiabilities)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              className={`text-sm ${ds.interactive.default} px-2 py-1 rounded`}
                              onClick={() => openDetail(snapshot)}
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Capture Modal */}
      <Modal
        isOpen={captureModalOpen}
        title="Capture Net Worth Snapshot"
        onClose={() => setCaptureModalOpen(false)}
      >
        <div className="space-y-4">
          <p className={`text-sm ${ds.text.secondary}`}>
            This will record current balances from all your accounts.
          </p>
          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Period Label (optional)
            </label>
            <Input
              placeholder="e.g., 2024-Q1 or 2024-01"
              value={captureForm.period}
              onChange={(e) => setCaptureForm({ ...captureForm, period: e.target.value })}
            />
            <div className={`text-xs ${ds.text.muted} mt-1`}>
              Suggestions: {getPeriodSuggestions().join(', ')}
            </div>
          </div>
          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Notes (optional)
            </label>
            <Input
              placeholder="Any notes about this snapshot"
              value={captureForm.notes}
              onChange={(e) => setCaptureForm({ ...captureForm, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setCaptureModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-[var(--accent)] hover:opacity-90 text-white"
              disabled={capturing}
              onClick={captureSnapshot}
            >
              {capturing ? 'Capturing...' : 'Capture Snapshot'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal - Enhanced with grouped breakdowns */}
      {selectedSnapshot && (
        <Modal
          isOpen={detailModalOpen}
          title={`Snapshot: ${formatDate(selectedSnapshot.date)}${selectedSnapshot.period ? ` (${selectedSnapshot.period})` : ''}`}
          onClose={() => setDetailModalOpen(false)}
        >
          <div className="space-y-5">
            <div className="flex justify-end">
              <button
                className="text-[var(--red)] hover:opacity-80 text-sm"
                onClick={() => deleteSnapshot(selectedSnapshot.id)}
              >
                Delete Snapshot
              </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className={`p-4 rounded-lg ${ds.bg.secondary} border-l-4 border-l-blue-500`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Net Worth</div>
                <div
                  className={`text-2xl font-bold font-mono ${selectedSnapshot.netWorth >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {formatCurrency(selectedSnapshot.netWorth)}
                </div>
              </div>
              <div className={`p-4 rounded-lg ${ds.bg.secondary} border-l-4 border-l-green-500`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Total Assets</div>
                <div className="text-2xl font-bold font-mono text-[var(--green)]">
                  {formatCurrency(selectedSnapshot.totalAssets)}
                </div>
              </div>
              <div className={`p-4 rounded-lg ${ds.bg.secondary} border-l-4 border-l-red-500`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Total Liabilities</div>
                <div className="text-2xl font-bold font-mono text-[var(--red)]">
                  {formatCurrency(selectedSnapshot.totalLiabilities)}
                </div>
              </div>
            </div>

            {selectedSnapshot.notes && (
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted} uppercase mb-1`}>Notes</div>
                <div className={`text-sm ${ds.text.primary}`}>{selectedSnapshot.notes}</div>
              </div>
            )}

            {/* Assets Breakdown by Type */}
            <div>
              <div
                className={`text-sm font-semibold ${ds.text.primary} mb-3 flex items-center gap-2`}
              >
                <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                Assets Breakdown
              </div>
              <div className="space-y-4 max-h-[250px] overflow-y-auto pr-1">
                {groupAccountsByType(selectedSnapshot.accountBalances, ASSET_GROUPS, true).map(
                  (group) => (
                    <div key={group.groupKey} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-sm"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className={`text-sm font-medium ${ds.text.primary}`}>
                            {group.label}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-[var(--green)]">
                          {formatCurrency(group.total)}
                        </span>
                      </div>
                      <div className={`ml-5 space-y-1 border-l-2 pl-3 ${ds.border.default}`}>
                        {group.accounts.map(({ id, acc }) => (
                          <div
                            key={id}
                            className={`flex items-center justify-between py-1 px-2 rounded ${ds.bg.tertiary}`}
                          >
                            <div>
                              <div className={`text-sm ${ds.text.primary}`}>{acc.name}</div>
                              {acc.currency !== 'USD' && (
                                <div className={`text-xs ${ds.text.muted}`}>{acc.currency}</div>
                              )}
                            </div>
                            <div className="text-sm font-medium text-[var(--green)]">
                              {formatCurrency(acc.balance)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
                {groupAccountsByType(selectedSnapshot.accountBalances, ASSET_GROUPS, true)
                  .length === 0 && (
                  <div className={`text-sm ${ds.text.muted} text-center py-4`}>No assets</div>
                )}
              </div>
            </div>

            {/* Liabilities Breakdown by Type */}
            <div>
              <div
                className={`text-sm font-semibold ${ds.text.primary} mb-3 flex items-center gap-2`}
              >
                <span className="w-2 h-2 rounded-full bg-[var(--red)]" />
                Liabilities Breakdown
              </div>
              <div className="space-y-4 max-h-[200px] overflow-y-auto pr-1">
                {groupAccountsByType(selectedSnapshot.accountBalances, LIABILITY_GROUPS, false).map(
                  (group) => (
                    <div key={group.groupKey} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-sm"
                            style={{ backgroundColor: group.color }}
                          />
                          <span className={`text-sm font-medium ${ds.text.primary}`}>
                            {group.label}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-[var(--red)]">
                          {formatCurrency(group.total)}
                        </span>
                      </div>
                      <div className={`ml-5 space-y-1 border-l-2 pl-3 ${ds.border.default}`}>
                        {group.accounts.map(({ id, acc }) => (
                          <div
                            key={id}
                            className={`flex items-center justify-between py-1 px-2 rounded ${ds.bg.tertiary}`}
                          >
                            <div>
                              <div className={`text-sm ${ds.text.primary}`}>{acc.name}</div>
                              {acc.currency !== 'USD' && (
                                <div className={`text-xs ${ds.text.muted}`}>{acc.currency}</div>
                              )}
                            </div>
                            <div className="text-sm font-medium text-[var(--red)]">
                              {formatCurrency(Math.abs(acc.balance))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
                {groupAccountsByType(selectedSnapshot.accountBalances, LIABILITY_GROUPS, false)
                  .length === 0 && (
                  <div className={`text-sm ${ds.text.muted} text-center py-4`}>No liabilities</div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={() => setDetailModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Comparison Modal */}
      {comparison && (
        <Modal
          isOpen={compareModalOpen}
          title="Snapshot Comparison"
          onClose={() => setCompareModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted}`}>
                  {formatDate(comparison.snapshot1.date)}
                </div>
                <div className={`text-lg font-bold ${ds.text.primary}`}>
                  {formatCurrency(comparison.snapshot1.netWorth)}
                </div>
              </div>
              <div
                className={`p-3 rounded-lg ${ds.bg.tertiary} flex flex-col items-center justify-center`}
              >
                <div className={`text-xs ${ds.text.muted}`}>Change</div>
                <div
                  className={`text-lg font-bold ${comparison.comparison.netWorthChange >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {comparison.comparison.netWorthChange >= 0 ? '+' : ''}
                  {formatCurrency(comparison.comparison.netWorthChange)}
                </div>
                <div
                  className={`text-sm ${comparison.comparison.netWorthChangePercent >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {formatPercent(comparison.comparison.netWorthChangePercent)}
                </div>
              </div>
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted}`}>
                  {formatDate(comparison.snapshot2.date)}
                </div>
                <div className={`text-lg font-bold ${ds.text.primary}`}>
                  {formatCurrency(comparison.snapshot2.netWorth)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Assets Change</div>
                <div
                  className={`text-lg font-bold ${comparison.comparison.assetsChange >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {comparison.comparison.assetsChange >= 0 ? '+' : ''}
                  {formatCurrency(comparison.comparison.assetsChange)}
                </div>
                <div className={`text-sm ${ds.text.muted}`}>
                  {formatPercent(comparison.comparison.assetsChangePercent)}
                </div>
              </div>
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Liabilities Change</div>
                <div
                  className={`text-lg font-bold ${comparison.comparison.liabilitiesChange <= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                >
                  {comparison.comparison.liabilitiesChange >= 0 ? '+' : ''}
                  {formatCurrency(comparison.comparison.liabilitiesChange)}
                </div>
                <div className={`text-sm ${ds.text.muted}`}>
                  {formatPercent(comparison.comparison.liabilitiesChangePercent)}
                </div>
              </div>
            </div>

            <div>
              <div className={`text-sm font-semibold ${ds.text.primary} mb-2`}>
                Account Changes (Top Movers)
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {comparison.comparison.accountChanges.slice(0, 10).map((acc) => (
                  <div
                    key={acc.accountId}
                    className={`flex items-center justify-between p-2 rounded ${ds.bg.secondary}`}
                  >
                    <div>
                      <div className={`text-sm ${ds.text.primary}`}>{acc.name}</div>
                      <div className={`text-xs ${ds.text.muted}`}>{acc.type}</div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-semibold ${acc.change >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}
                      >
                        {acc.change >= 0 ? '+' : ''}
                        {formatCurrency(acc.change)}
                      </div>
                      <div className={`text-xs ${ds.text.muted}`}>
                        {formatCurrency(acc.balance1)} → {formatCurrency(acc.balance2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={() => setCompareModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Backfill Historical Modal */}
      <Modal
        isOpen={backfillModalOpen}
        title="Backfill Historical Net Worth"
        onClose={() => setBackfillModalOpen(false)}
      >
        <div className="space-y-4">
          <p className={`text-sm ${ds.text.secondary}`}>
            Manually enter historical net worth data from your past records. This is useful for
            tracking trends from before you started using this app.
          </p>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Date <span className="text-[var(--red)]">*</span>
            </label>
            <Input
              type="date"
              value={backfillForm.date}
              onChange={(e) => setBackfillForm({ ...backfillForm, date: e.target.value })}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Net Worth <span className="text-[var(--red)]">*</span>
            </label>
            <Input
              placeholder="e.g., 50000 or -5000"
              type="text"
              value={backfillForm.netWorth}
              onChange={(e) => setBackfillForm({ ...backfillForm, netWorth: e.target.value })}
            />
            <div className={`text-xs ${ds.text.muted} mt-1`}>
              Use negative values if liabilities exceeded assets
            </div>
          </div>

          <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
            <div className={`text-xs font-medium ${ds.text.primary} mb-2`}>
              Optional Breakdown (for more detailed tracking)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-xs ${ds.text.secondary} mb-1`}>Total Assets</label>
                <Input
                  placeholder="e.g., 100000"
                  type="text"
                  value={backfillForm.totalAssets}
                  onChange={(e) =>
                    setBackfillForm({ ...backfillForm, totalAssets: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={`block text-xs ${ds.text.secondary} mb-1`}>
                  Total Liabilities
                </label>
                <Input
                  placeholder="e.g., 50000"
                  type="text"
                  value={backfillForm.totalLiabilities}
                  onChange={(e) =>
                    setBackfillForm({ ...backfillForm, totalLiabilities: e.target.value })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Period Label (optional)
            </label>
            <Input
              placeholder="e.g., 2023-Q4 or 2023-12"
              value={backfillForm.period}
              onChange={(e) => setBackfillForm({ ...backfillForm, period: e.target.value })}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Notes (optional)
            </label>
            <Input
              placeholder="e.g., From spreadsheet tracking"
              value={backfillForm.notes}
              onChange={(e) => setBackfillForm({ ...backfillForm, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setBackfillModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-[var(--accent)] hover:opacity-90 text-white"
              disabled={backfillSaving || !backfillForm.date || !backfillForm.netWorth}
              onClick={saveBackfillSnapshot}
            >
              {backfillSaving ? 'Saving...' : 'Save Historical Snapshot'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
