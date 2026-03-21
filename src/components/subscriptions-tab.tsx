'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';
import { formatAmountCompact } from '@/lib/currency';
import { triggerSync } from '@/lib/cloud-sync';

type RecurringItem = {
  id: string;
  merchantPattern: string;
  merchantDisplay: string;
  accountId: string;
  categoryId: string | null;
  frequency: string;
  expectedAmount: number;
  amountVariance: number;
  expectedDayOfMonth: number | null;
  medianIntervalDays: number;
  confidence: number;
  intervalRegularity: number;
  amountConsistency: number;
  transactionCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  status: string;
  nextExpectedDate: string | null;
  isManualOverride: boolean;
  manuallyCreated: boolean;
  priceHistory: Array<{ date: string; amount: number }>;
  monthlyEquivalent: number;
  account: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
};

type Summary = {
  totalMonthlyEstimate: number;
  totalAnnualEstimate: number;
  activeCount: number;
  lapsedCount: number;
};

type Category = {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
};

type UserSettings = {
  baseCurrency: string;
};

interface SubscriptionsTabProps {
  categories: Category[];
  accounts: { id: string; name: string }[];
  userSettings: UserSettings | null;
}

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: ds.status.success.bg, text: ds.status.success.text, label: 'Active' },
  lapsed: { bg: ds.status.warning.bg, text: ds.status.warning.text, label: 'Lapsed' },
  cancelled: { bg: ds.status.error.bg, text: ds.status.error.text, label: 'Cancelled' },
  paused: { bg: ds.status.info.bg, text: ds.status.info.text, label: 'Paused' },
};

const formatCurrency = (amount: number, baseCurrency: string = 'USD') => {
  return formatAmountCompact(amount, 'USD', baseCurrency);
};

export function SubscriptionsTab({ categories, accounts, userSettings }: SubscriptionsTabProps) {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'lapsed' | 'cancelled'>('all');
  const [detecting, setDetecting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
  const [editForm, setEditForm] = useState({
    merchantDisplay: '',
    frequency: '',
    expectedAmount: '',
    categoryId: '',
    status: '',
    expectedDayOfMonth: '',
  });

  // Add modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    merchantDisplay: '',
    accountId: '',
    frequency: 'monthly',
    expectedAmount: '',
    categoryId: '',
    expectedDayOfMonth: '',
  });

  const loadData = async () => {
    try {
      const res = await fetch('/api/recurring');
      const data = await res.json();
      setItems(data.items ?? []);
      setSummary({
        totalMonthlyEstimate: data.totalMonthlyEstimate,
        totalAnnualEstimate: data.totalAnnualEstimate,
        activeCount: data.activeCount,
        lapsedCount: data.lapsedCount,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const runDetection = async () => {
    setDetecting(true);
    try {
      await fetch('/api/recurring/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await loadData();
    } finally {
      setDetecting(false);
    }
  };

  const openEditModal = (item: RecurringItem) => {
    setEditingItem(item);
    setEditForm({
      merchantDisplay: item.merchantDisplay,
      frequency: item.frequency,
      expectedAmount: String(Math.abs(item.expectedAmount)),
      categoryId: item.categoryId || '',
      status: item.status,
      expectedDayOfMonth: item.expectedDayOfMonth ? String(item.expectedDayOfMonth) : '',
    });
    setEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editingItem) return;
    await fetch(`/api/recurring/${editingItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantDisplay: editForm.merchantDisplay,
        frequency: editForm.frequency,
        expectedAmount: parseFloat(editForm.expectedAmount) * -1,
        categoryId: editForm.categoryId || null,
        status: editForm.status,
        expectedDayOfMonth: editForm.expectedDayOfMonth
          ? parseInt(editForm.expectedDayOfMonth)
          : null,
      }),
    });
    setEditModalOpen(false);
    setEditingItem(null);
    loadData();
    triggerSync();
  };

  const dismissItem = async (id: string) => {
    await fetch(`/api/recurring/${id}`, { method: 'DELETE' });
    loadData();
    triggerSync();
  };

  const markCancelled = async (id: string) => {
    await fetch(`/api/recurring/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    loadData();
    triggerSync();
  };

  const saveNewSubscription = async () => {
    if (!addForm.merchantDisplay || !addForm.accountId || !addForm.expectedAmount) return;
    await fetch('/api/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantDisplay: addForm.merchantDisplay,
        accountId: addForm.accountId,
        frequency: addForm.frequency,
        expectedAmount: parseFloat(addForm.expectedAmount) * -1,
        categoryId: addForm.categoryId || null,
        expectedDayOfMonth: addForm.expectedDayOfMonth
          ? parseInt(addForm.expectedDayOfMonth)
          : null,
      }),
    });
    setAddModalOpen(false);
    setAddForm({
      merchantDisplay: '',
      accountId: '',
      frequency: 'monthly',
      expectedAmount: '',
      categoryId: '',
      expectedDayOfMonth: '',
    });
    loadData();
    triggerSync();
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  // Group by frequency
  const grouped = new Map<string, RecurringItem[]>();
  for (const item of filteredItems) {
    const key = item.frequency;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  // Price change detection
  const priceChanges = items.filter((item) => {
    if (item.status !== 'active' || item.priceHistory.length < 2) return false;
    const latest = item.priceHistory[item.priceHistory.length - 1];
    const previous = item.priceHistory[item.priceHistory.length - 2];
    return Math.abs(latest.amount - previous.amount) / previous.amount > 0.05;
  });

  const lapsedItems = items.filter((item) => item.status === 'lapsed');
  const baseCurrency = userSettings?.baseCurrency || 'USD';

  if (loading) {
    return (
      <div className={`py-8 text-center text-sm ${ds.text.muted}`}>Loading subscriptions...</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            className="bg-[var(--accent)] text-white hover:opacity-90 py-2 px-4 text-sm"
            disabled={detecting}
            onClick={runDetection}
          >
            {detecting ? 'Detecting...' : 'Run Detection'}
          </Button>
          <Button
            className={`${ds.bg.secondary} ${ds.text.primary} hover:opacity-80 py-2 px-4 text-sm border ${ds.border.default}`}
            onClick={() => setAddModalOpen(true)}
          >
            + Add Manual
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wider`}>
                Monthly Cost
              </div>
              <div className={`text-2xl font-bold font-mono ${ds.text.primary} mt-1`}>
                {formatCurrency(summary.totalMonthlyEstimate, baseCurrency)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wider`}>
                Annual Cost
              </div>
              <div className={`text-2xl font-bold font-mono ${ds.text.primary} mt-1`}>
                {formatCurrency(summary.totalAnnualEstimate, baseCurrency)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className={`text-xs font-medium ${ds.text.muted} uppercase tracking-wider`}>
                Active Subscriptions
              </div>
              <div className={`text-2xl font-bold font-mono ${ds.text.primary} mt-1`}>
                {summary.activeCount}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Alerts */}
      {lapsedItems.length > 0 && (
        <Card className={`${ds.status.warning.border} ${ds.status.warning.bg}`}>
          <CardContent className="py-3">
            <div className={`text-sm font-medium ${ds.status.warning.text}`}>
              {lapsedItems.length} subscription{lapsedItems.length > 1 ? 's' : ''} may have been
              cancelled — no charge received within the expected window.
            </div>
            <div className={`text-xs ${ds.status.warning.text} mt-1 opacity-80`}>
              {lapsedItems.map((i) => i.merchantDisplay).join(', ')}
            </div>
          </CardContent>
        </Card>
      )}

      {priceChanges.length > 0 && (
        <Card className={`${ds.status.info.border} ${ds.status.info.bg}`}>
          <CardContent className="py-3">
            <div className={`text-sm font-medium ${ds.status.info.text}`}>
              {priceChanges.length} subscription{priceChanges.length > 1 ? 's' : ''} had a price
              change.
            </div>
            <div className={`text-xs ${ds.status.info.text} mt-1 opacity-80`}>
              {priceChanges
                .map((i) => {
                  const latest = i.priceHistory[i.priceHistory.length - 1];
                  const prev = i.priceHistory[i.priceHistory.length - 2];
                  const dir = latest.amount > prev.amount ? 'up' : 'down';
                  return `${i.merchantDisplay} (${dir} to ${formatCurrency(latest.amount, baseCurrency)})`;
                })
                .join(', ')}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'active', 'lapsed', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                : `${ds.text.secondary} hover:${ds.bg.tertiary}`
            }`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'active' && summary ? ` (${summary.activeCount})` : ''}
            {f === 'lapsed' && summary ? ` (${summary.lapsedCount})` : ''}
          </button>
        ))}
      </div>

      {/* Grouped list */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className={`text-center ${ds.text.muted}`}>
              <div className="text-lg font-medium mb-2">No subscriptions detected yet</div>
              <div className="text-sm mb-4">
                Click &quot;Run Detection&quot; to scan your transactions for recurring charges, or
                add one manually.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className={`text-center text-sm ${ds.text.muted}`}>
              No subscriptions match this filter.
            </div>
          </CardContent>
        </Card>
      ) : (
        Array.from(grouped.entries())
          .sort(([a], [b]) => {
            const order = ['monthly', 'quarterly', 'annual', 'weekly', 'biweekly'];
            return order.indexOf(a) - order.indexOf(b);
          })
          .map(([frequency, groupItems]) => (
            <Card key={frequency}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className={`text-sm font-semibold ${ds.text.primary}`}>
                    {FREQUENCY_LABELS[frequency] || frequency}
                  </div>
                  <Badge tone="default">{groupItems.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={ds.table.header}>
                      <th className="text-left px-4 py-2 font-medium">Merchant</th>
                      <th className="text-left px-4 py-2 font-medium">Account</th>
                      <th className="text-left px-4 py-2 font-medium">Category</th>
                      <th className="text-right px-4 py-2 font-medium">Amount</th>
                      <th className="text-right px-4 py-2 font-medium">Monthly Eq.</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Next Expected</th>
                      <th className="text-right px-4 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupItems
                      .sort((a, b) => Math.abs(b.expectedAmount) - Math.abs(a.expectedAmount))
                      .map((item) => {
                        const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.active;
                        return (
                          <tr key={item.id} className={ds.table.row}>
                            <td className="px-4 py-2.5">
                              <div className={`font-medium ${ds.text.primary}`}>
                                {item.merchantDisplay}
                              </div>
                              <div className={`text-xs ${ds.text.muted}`}>
                                {item.transactionCount} transactions
                                {item.confidence < 0.9 && !item.manuallyCreated && (
                                  <span className="ml-1 opacity-70">
                                    ({Math.round(item.confidence * 100)}% confidence)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-4 py-2.5 ${ds.text.secondary}`}>
                              {item.account?.name || '—'}
                            </td>
                            <td className={`px-4 py-2.5 ${ds.text.secondary}`}>
                              {item.category?.name || '—'}
                            </td>
                            <td className={`px-4 py-2.5 text-right font-medium ${ds.text.primary}`}>
                              {formatCurrency(Math.abs(item.expectedAmount), baseCurrency)}
                            </td>
                            <td className={`px-4 py-2.5 text-right ${ds.text.muted}`}>
                              {frequency !== 'monthly' && (
                                <span>
                                  {formatCurrency(item.monthlyEquivalent, baseCurrency)}/mo
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                              >
                                {statusStyle.label}
                              </span>
                            </td>
                            <td className={`px-4 py-2.5 ${ds.text.secondary}`}>
                              {item.nextExpectedDate
                                ? new Date(item.nextExpectedDate).toLocaleDateString()
                                : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  className={`px-2 py-1 rounded text-xs ${ds.text.secondary} hover:${ds.bg.tertiary}`}
                                  onClick={() => openEditModal(item)}
                                >
                                  Edit
                                </button>
                                {item.status === 'active' && (
                                  <button
                                    className="px-2 py-1 rounded text-xs text-[var(--yellow)] hover:bg-[var(--yellow)]/10"
                                    onClick={() => markCancelled(item.id)}
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  className="px-2 py-1 rounded text-xs text-[var(--red)] hover:bg-[var(--red)]/10"
                                  onClick={() => dismissItem(item.id)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={editModalOpen}
        title="Edit Subscription"
        onClose={() => setEditModalOpen(false)}
      >
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
              Merchant Name
            </label>
            <Input
              value={editForm.merchantDisplay}
              onChange={(e) => setEditForm({ ...editForm, merchantDisplay: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Frequency
              </label>
              <Select
                value={editForm.frequency}
                onChange={(e) => setEditForm({ ...editForm, frequency: e.target.value })}
              >
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Amount
              </label>
              <Input
                step="0.01"
                type="number"
                value={editForm.expectedAmount}
                onChange={(e) => setEditForm({ ...editForm, expectedAmount: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Category
              </label>
              <Select
                value={editForm.categoryId}
                onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
              >
                <option value="">Uncategorized</option>
                {categories
                  .filter((c) => c.type === 'expense')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Status
              </label>
              <Select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
                <option value="lapsed">Lapsed</option>
              </Select>
            </div>
          </div>
          <div>
            <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
              Billing Day of Month (optional)
            </label>
            <Input
              max="31"
              min="1"
              placeholder="e.g. 15"
              type="number"
              value={editForm.expectedDayOfMonth}
              onChange={(e) => setEditForm({ ...editForm, expectedDayOfMonth: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              className={`${ds.bg.secondary} ${ds.text.primary} hover:opacity-80 py-2 px-4 text-sm border ${ds.border.default}`}
              onClick={() => setEditModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-[var(--accent)] text-white hover:opacity-90 py-2 px-4 text-sm"
              onClick={saveEdit}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Manual Modal */}
      <Modal
        isOpen={addModalOpen}
        title="Add Manual Subscription"
        onClose={() => setAddModalOpen(false)}
      >
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
              Merchant Name
            </label>
            <Input
              placeholder="e.g. Netflix"
              value={addForm.merchantDisplay}
              onChange={(e) => setAddForm({ ...addForm, merchantDisplay: e.target.value })}
            />
          </div>
          <div>
            <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Account</label>
            <Select
              value={addForm.accountId}
              onChange={(e) => setAddForm({ ...addForm, accountId: e.target.value })}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Frequency
              </label>
              <Select
                value={addForm.frequency}
                onChange={(e) => setAddForm({ ...addForm, frequency: e.target.value })}
              >
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Amount
              </label>
              <Input
                placeholder="9.99"
                step="0.01"
                type="number"
                value={addForm.expectedAmount}
                onChange={(e) => setAddForm({ ...addForm, expectedAmount: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Category
              </label>
              <Select
                value={addForm.categoryId}
                onChange={(e) => setAddForm({ ...addForm, categoryId: e.target.value })}
              >
                <option value="">Uncategorized</option>
                {categories
                  .filter((c) => c.type === 'expense')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                Billing Day (optional)
              </label>
              <Input
                max="31"
                min="1"
                placeholder="e.g. 15"
                type="number"
                value={addForm.expectedDayOfMonth}
                onChange={(e) => setAddForm({ ...addForm, expectedDayOfMonth: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              className={`${ds.bg.secondary} ${ds.text.primary} hover:opacity-80 py-2 px-4 text-sm border ${ds.border.default}`}
              onClick={() => setAddModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-[var(--accent)] text-white hover:opacity-90 py-2 px-4 text-sm"
              onClick={saveNewSubscription}
            >
              Add Subscription
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
