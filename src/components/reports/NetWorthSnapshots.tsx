'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';

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

  return (
    <div className="space-y-4">
      {/* Current Net Worth Card */}
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
            <div className="grid grid-cols-4 gap-6">
              <div>
                <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                  Net Worth
                </div>
                <div
                  className={`text-2xl font-bold ${latestSnapshot.netWorth >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrency(latestSnapshot.netWorth)}
                </div>
              </div>
              <div>
                <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                  Total Assets
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(latestSnapshot.totalAssets)}
                </div>
              </div>
              <div>
                <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                  Total Liabilities
                </div>
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(latestSnapshot.totalLiabilities)}
                </div>
              </div>
              <div>
                <div className={`text-xs ${ds.text.muted} uppercase tracking-wide mb-1`}>
                  Last Captured
                </div>
                <div className={`text-lg font-semibold ${ds.text.primary}`}>
                  {formatDate(latestSnapshot.date)}
                </div>
                {latestSnapshot.period && (
                  <div className={`text-sm ${ds.text.secondary}`}>{latestSnapshot.period}</div>
                )}
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

      {/* Detail Modal */}
      {selectedSnapshot && (
        <Modal
          isOpen={detailModalOpen}
          title={`Snapshot: ${formatDate(selectedSnapshot.date)}${selectedSnapshot.period ? ` (${selectedSnapshot.period})` : ''}`}
          onClose={() => setDetailModalOpen(false)}
        >
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                className="text-red-600 hover:text-red-700 text-sm"
                onClick={() => deleteSnapshot(selectedSnapshot.id)}
              >
                Delete Snapshot
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Net Worth</div>
                <div
                  className={`text-xl font-bold ${selectedSnapshot.netWorth >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrency(selectedSnapshot.netWorth)}
                </div>
              </div>
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Assets</div>
                <div className="text-xl font-bold text-green-600">
                  {formatCurrency(selectedSnapshot.totalAssets)}
                </div>
              </div>
              <div className={`p-3 rounded-lg ${ds.bg.secondary}`}>
                <div className={`text-xs ${ds.text.muted} uppercase`}>Liabilities</div>
                <div className="text-xl font-bold text-red-600">
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

            <div>
              <div className={`text-sm font-semibold ${ds.text.primary} mb-2`}>
                Account Breakdown
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {Object.entries(selectedSnapshot.accountBalances)
                  .sort(([, a], [, b]) => Math.abs(b.balance) - Math.abs(a.balance))
                  .map(([accountId, acc]) => (
                    <div
                      key={accountId}
                      className={`flex items-center justify-between p-2 rounded ${ds.bg.secondary}`}
                    >
                      <div>
                        <div className={`text-sm ${ds.text.primary}`}>{acc.name}</div>
                        <div className={`text-xs ${ds.text.muted}`}>
                          {acc.type} {acc.currency !== 'USD' && `• ${acc.currency}`}
                        </div>
                      </div>
                      <div
                        className={`font-semibold ${acc.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {formatCurrency(acc.balance)}
                      </div>
                    </div>
                  ))}
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
    </div>
  );
}
