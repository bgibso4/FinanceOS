'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';

type GoalWithProgress = {
  id: string;
  name: string;
  type: string;
  targetAmount: number;
  trackingMethod: string;
  categoryId: string | null;
  tagId: string | null;
  accountId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  currentAmount: number;
  percentage: number;
  remaining: number;
  paceStatus: 'on_track' | 'ahead' | 'behind' | null;
  category?: { id: string; name: string; parentId: string | null } | null;
  tag?: { id: string; name: string; color: string } | null;
  account?: { id: string; name: string; type: string } | null;
};

type CategoryOption = { id: string; name: string; parentId: string | null };
type TagOption = { id: string; name: string; color: string };
type AccountOption = { id: string; name: string; type: string };

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

const formatDateRange = (start: string | null, end: string | null) => {
  if (!start && !end) return 'Open-ended';
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
};

const paceColors: Record<string, string> = {
  ahead: 'bg-green-500',
  on_track: 'bg-blue-500',
  behind: 'bg-red-500',
};

const paceLabels: Record<string, string> = {
  ahead: 'Ahead',
  on_track: 'On Track',
  behind: 'Behind',
};

function GoalCard({
  goal,
  onEdit,
}: {
  goal: GoalWithProgress;
  onEdit: (goal: GoalWithProgress) => void;
}) {
  const trackingLabel =
    goal.trackingMethod === 'category'
      ? `${goal.category?.name ?? 'Unknown'} category`
      : goal.trackingMethod === 'tag'
        ? `${goal.tag?.name ?? 'Unknown'} tag`
        : `${goal.account?.name ?? 'Unknown'} account`;

  const barColor = goal.paceStatus ? paceColors[goal.paceStatus] : 'bg-blue-500';
  const cappedPercentage = Math.min(goal.percentage, 100);

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onEdit(goal)}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className={`font-semibold ${ds.text.primary}`}>{goal.name}</h3>
            <p className={`text-xs ${ds.text.muted} mt-0.5`}>{trackingLabel}</p>
          </div>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              goal.type === 'spending'
                ? `${ds.status.error.bg} ${ds.status.error.text}`
                : `${ds.status.success.bg} ${ds.status.success.text}`
            }`}
          >
            {goal.type === 'spending' ? 'Spending' : 'Saving'}
          </span>
        </div>

        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm font-semibold ${ds.text.primary}`}>
              {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
            </span>
            <span className={`text-xs font-medium ${ds.text.muted}`}>
              {goal.percentage.toFixed(0)}%
            </span>
          </div>
          <div className={`h-2 ${ds.bg.tertiary} rounded-full overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${cappedPercentage}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className={`text-xs ${ds.text.muted}`}>
            {formatDateRange(goal.startDate, goal.endDate)}
          </span>
          <div className="flex items-center gap-2">
            {goal.paceStatus && (
              <span
                className={`text-xs font-medium ${
                  goal.paceStatus === 'ahead'
                    ? 'text-green-600'
                    : goal.paceStatus === 'behind'
                      ? 'text-red-600'
                      : ds.status.info.text
                }`}
              >
                {paceLabels[goal.paceStatus]}
              </span>
            )}
            <span className={`text-xs ${ds.text.muted}`}>
              {formatCurrency(goal.remaining)} left
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalFormModal({
  isOpen,
  onClose,
  onSave,
  goal,
  categories,
  tags,
  accounts,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  goal: GoalWithProgress | null;
  categories: CategoryOption[];
  tags: TagOption[];
  accounts: AccountOption[];
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'spending' | 'saving'>('spending');
  const [targetAmount, setTargetAmount] = useState('');
  const [trackingMethod, setTrackingMethod] = useState<'category' | 'tag' | 'account'>('category');
  const [categoryId, setCategoryId] = useState('');
  const [tagId, setTagId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [timeframe, setTimeframe] = useState<'year' | 'quarter' | 'custom' | 'open'>('year');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('active');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (goal) {
      setName(goal.name);
      setType(goal.type as 'spending' | 'saving');
      setTargetAmount(String(goal.targetAmount));
      setTrackingMethod(goal.trackingMethod as 'category' | 'tag' | 'account');
      setCategoryId(goal.categoryId ?? '');
      setTagId(goal.tagId ?? '');
      setAccountId(goal.accountId ?? '');
      setStatus(goal.status);
      if (goal.startDate || goal.endDate) {
        setTimeframe('custom');
        setStartDate(goal.startDate ?? '');
        setEndDate(goal.endDate ?? '');
      } else {
        setTimeframe('open');
        setStartDate('');
        setEndDate('');
      }
    } else {
      setName('');
      setType('spending');
      setTargetAmount('');
      setTrackingMethod('category');
      setCategoryId('');
      setTagId('');
      setAccountId('');
      setStatus('active');
      setTimeframe('year');
      const year = new Date().getFullYear();
      setStartDate(`${year}-01-01`);
      setEndDate(`${year}-12-31`);
    }
  }, [goal, isOpen]);

  const applyPreset = (preset: string) => {
    const year = new Date().getFullYear();
    const month = new Date().getMonth();
    setTimeframe(preset as 'year' | 'quarter' | 'custom' | 'open');

    if (preset === 'year') {
      setStartDate(`${year}-01-01`);
      setEndDate(`${year}-12-31`);
    } else if (preset === 'quarter') {
      const qStart = Math.floor(month / 3) * 3;
      const qStartMonth = String(qStart + 1).padStart(2, '0');
      const qEndMonth = String(qStart + 3).padStart(2, '0');
      const qEndDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][qStart + 2];
      setStartDate(`${year}-${qStartMonth}-01`);
      setEndDate(`${year}-${qEndMonth}-${qEndDay}`);
    } else if (preset === 'open') {
      setStartDate('');
      setEndDate('');
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    const data = {
      name,
      type,
      targetAmount: parseFloat(targetAmount),
      trackingMethod,
      categoryId: trackingMethod === 'category' ? categoryId : undefined,
      tagId: trackingMethod === 'tag' ? tagId : undefined,
      accountId: trackingMethod === 'account' ? accountId : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      ...(goal ? { status } : {}),
    };

    const url = goal ? `/api/goals/${goal.id}` : '/api/goals';
    const method = goal ? 'PATCH' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setSaving(false);
    onSave();
    onClose();
  };

  const handleDelete = async () => {
    if (!goal) return;
    await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' });
    onSave();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title={goal ? 'Edit Goal' : 'New Goal'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Name</label>
          <input
            className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
            placeholder="e.g. 2026 Travel Budget"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Type</label>
          <div className="flex gap-2">
            {(['spending', 'saving'] as const).map((t) => (
              <button
                key={t}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  type === t
                    ? 'bg-slate-900 dark:bg-slate-600 text-white'
                    : `${ds.bg.tertiary} ${ds.text.secondary}`
                }`}
                type="button"
                onClick={() => setType(t)}
              >
                {t === 'spending' ? 'Spending' : 'Saving'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
            Target Amount
          </label>
          <input
            className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
            placeholder="5000"
            type="number"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
          />
        </div>

        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Track By</label>
          <div className="flex gap-2">
            {(['category', 'tag', 'account'] as const).map((m) => (
              <button
                key={m}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  trackingMethod === m
                    ? 'bg-slate-900 dark:bg-slate-600 text-white'
                    : `${ds.bg.tertiary} ${ds.text.secondary}`
                }`}
                type="button"
                onClick={() => setTrackingMethod(m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          {trackingMethod === 'category' && (
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? '  ' : ''}
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {trackingMethod === 'tag' && (
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
            >
              <option value="">Select tag...</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {trackingMethod === 'account' && (
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Timeframe</label>
          <div className="flex gap-2 mb-2">
            {[
              { key: 'year', label: 'This Year' },
              { key: 'quarter', label: 'This Quarter' },
              { key: 'custom', label: 'Custom' },
              { key: 'open', label: 'Open-ended' },
            ].map((p) => (
              <button
                key={p.key}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  timeframe === p.key
                    ? 'bg-slate-900 dark:bg-slate-600 text-white'
                    : `${ds.bg.tertiary} ${ds.text.secondary}`
                }`}
                type="button"
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {timeframe !== 'open' && (
            <div className="flex gap-2">
              <input
                className={`flex-1 rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setTimeframe('custom');
                }}
              />
              <input
                className={`flex-1 rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setTimeframe('custom');
                }}
              />
            </div>
          )}
        </div>

        {goal && (
          <div>
            <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Status</label>
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {goal ? (
            <button
              className="text-sm text-red-600 hover:text-red-700 font-medium"
              type="button"
              onClick={handleDelete}
            >
              Delete Goal
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!name || !targetAmount || saving} onClick={handleSubmit}>
              {saving ? 'Saving...' : goal ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function GoalsPageContent() {
  const searchParams = useSearchParams();
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalWithProgress | null>(null);
  const statusFilter = searchParams.get('status') || 'active';

  const loadData = useCallback(async () => {
    const [goalsRes, catsRes, tagsRes, accsRes] = await Promise.all([
      fetch(`/api/goals?status=${statusFilter}`).then((r) => r.json()),
      fetch('/api/categories').then((r) => r.json()),
      fetch('/api/tags').then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
    ]);
    setGoals(goalsRes.goals);
    setCategories(catsRes.categories);
    setTags(tagsRes.tags);
    setAccounts(accsRes.accounts);
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEdit = (goal: GoalWithProgress) => {
    setEditingGoal(goal);
    setShowModal(true);
  };

  const handleNew = () => {
    setEditingGoal(null);
    setShowModal(true);
  };

  const tabs = [
    { label: 'Active', value: 'active' },
    { label: 'Completed', value: 'completed' },
    { label: 'Archived', value: 'archived' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className={`text-2xl font-bold ${ds.text.heading}`}>Goals</h1>
        <Button onClick={handleNew}>New Goal</Button>
      </div>

      <div className="flex gap-1">
        {tabs.map((tab) => (
          <a
            key={tab.value}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              statusFilter === tab.value
                ? 'bg-slate-900 dark:bg-slate-700 text-white'
                : `${ds.text.secondary} hover:bg-slate-100 dark:hover:bg-slate-700`
            }`}
            href={`/goals?status=${tab.value}`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className={`${ds.text.muted} mb-4`}>
              {statusFilter === 'active'
                ? 'No active goals yet. Create one to start tracking.'
                : `No ${statusFilter} goals.`}
            </p>
            {statusFilter === 'active' && (
              <Button onClick={handleNew}>Create Your First Goal</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onEdit={handleEdit} />
          ))}
        </div>
      )}

      <GoalFormModal
        accounts={accounts}
        categories={categories}
        goal={editingGoal}
        isOpen={showModal}
        tags={tags}
        onClose={() => setShowModal(false)}
        onSave={loadData}
      />
    </div>
  );
}

export default function GoalsPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading goals...</div>}>
      <GoalsPageContent />
    </Suspense>
  );
}
