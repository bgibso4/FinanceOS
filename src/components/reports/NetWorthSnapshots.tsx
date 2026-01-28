'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';

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

const formatShortDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

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
        <div className={`text-sm font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? '+' : ''}
          {formatCurrency(change)}
        </div>
        <div className={`text-xs ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
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
      <div className="h-3 rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-700">
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

  useEffect(() => {
    loadSnapshots();
  }, []);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/snapshots?limit=20');
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    } finally {
      setLoading(false);
    }
  };

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
              {snapshots.length >= 2 && (
                <Button
                  className={compareMode ? 'bg-purple-600 hover:bg-purple-700 text-white' : ''}
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
                className="bg-blue-600 hover:bg-blue-700 text-white"
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
                  </div>
                  <div className="flex items-baseline gap-3">
                    <div
                      className={`text-4xl font-bold ${latestSnapshot.netWorth >= 0 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(latestSnapshot.netWorth)}
                    </div>
                    {netWorthChange !== null && (
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-sm font-medium ${netWorthChange >= 0 ? 'text-green-600' : 'text-red-600'}`}
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
                    <div className="text-xl font-bold text-green-600">
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
                    <div className="text-xl font-bold text-red-600">
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

      {/* Snapshot History */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div className={`text-sm font-semibold ${ds.text.primary}`}>Snapshot History</div>
              {compareMode && compareSelection.length === 2 && (
                <Button
                  className="bg-purple-600 hover:bg-purple-700 text-white shrink-0"
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
                          className={`hover:${ds.bg.secondary} ${isSelected ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}
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
                              className={`font-semibold ${snapshot.netWorth >= 0 ? 'text-green-600' : 'text-red-600'}`}
                            >
                              {formatCurrency(snapshot.netWorth)}
                            </span>
                            {change !== null && (
                              <span
                                className={`ml-2 text-xs ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}
                              >
                                {change >= 0 ? '+' : ''}
                                {formatCurrency(change)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-green-600">
                            {formatCurrency(snapshot.totalAssets)}
                          </td>
                          <td className="px-3 py-2 text-right text-red-600">
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
              className="bg-blue-600 hover:bg-blue-700 text-white"
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
                className="text-red-600 hover:text-red-700 text-sm"
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
                  className={`text-2xl font-bold ${selectedSnapshot.netWorth >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrency(selectedSnapshot.netWorth)}
                </div>
              </div>
              <div className={`p-4 rounded-lg ${ds.bg.secondary} border-l-4 border-l-green-500`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Total Assets</div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(selectedSnapshot.totalAssets)}
                </div>
              </div>
              <div className={`p-4 rounded-lg ${ds.bg.secondary} border-l-4 border-l-red-500`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Total Liabilities</div>
                <div className="text-2xl font-bold text-red-600">
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
                <span className="w-2 h-2 rounded-full bg-green-500" />
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
                        <span className="text-sm font-semibold text-green-600">
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
                            <div className="text-sm font-medium text-green-600">
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
                <span className="w-2 h-2 rounded-full bg-red-500" />
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
                        <span className="text-sm font-semibold text-red-600">
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
                            <div className="text-sm font-medium text-red-600">
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
                  className={`text-lg font-bold ${comparison.comparison.netWorthChange >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {comparison.comparison.netWorthChange >= 0 ? '+' : ''}
                  {formatCurrency(comparison.comparison.netWorthChange)}
                </div>
                <div
                  className={`text-sm ${comparison.comparison.netWorthChangePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}
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
                  className={`text-lg font-bold ${comparison.comparison.assetsChange >= 0 ? 'text-green-600' : 'text-red-600'}`}
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
                  className={`text-lg font-bold ${comparison.comparison.liabilitiesChange <= 0 ? 'text-green-600' : 'text-red-600'}`}
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
                        className={`font-semibold ${acc.change >= 0 ? 'text-green-600' : 'text-red-600'}`}
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
              Date <span className="text-red-500">*</span>
            </label>
            <Input
              type="date"
              value={backfillForm.date}
              onChange={(e) => setBackfillForm({ ...backfillForm, date: e.target.value })}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Net Worth <span className="text-red-500">*</span>
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
              className="bg-blue-600 hover:bg-blue-700 text-white"
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
