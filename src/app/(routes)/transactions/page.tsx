'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { ds } from '@/lib/design-system';
import { formatAmountCompact, getCurrencyFlag } from '@/lib/currency';
import { triggerSync } from '@/lib/cloud-sync';
import { FilterRibbon } from '@/components/filter-ribbon';
import type { TagDef } from '@/components/tag-input';
import { CategorySelect } from '@/components/transactions/category-select';
import { SubscriptionsTab } from '@/components/subscriptions-tab';
import {
  TransactionDrawer,
  type TransactionDrawerHandle,
} from '@/components/transactions/transaction-drawer';
import { applyFields } from '@/components/transactions/types';
import type { Category, Tx, TxFields } from '@/components/transactions/types';

type Queue = {
  uncategorized: Tx[];
  lowConfidence: Tx[];
  highConfidence: Tx[];
  unlinkedReturns: Tx[];
  outliers: Tx[];
};

type OpenOpts = { startLinking?: boolean };
type DrawerTarget = { mode: 'edit'; id: string; linkRequest?: number } | { mode: 'new' } | null;

const QUEUE_ORDER = [
  'uncategorized',
  'lowConfidence',
  'unlinkedReturns',
  'highConfidence',
  'outliers',
] as const;

// A transaction can sit in several review sections; paging visits it once, at its first.
function reviewList(queue: Queue | null): Tx[] {
  const seen = new Set<string>();
  return QUEUE_ORDER.flatMap((key) => queue?.[key] ?? []).filter((tx) => {
    if (seen.has(tx.id)) return false;
    seen.add(tx.id);
    return true;
  });
}

// Reaches past the page's filter, e.g. to a refund's original from months back.
async function fetchLastYear(): Promise<Tx[] | null> {
  try {
    const res = await fetch('/api/transactions?preset=last-12-months');
    const data: { transactions?: Tx[] } = await res.json();
    return data.transactions ?? [];
  } catch {
    return null;
  }
}

const patchRow = (list: Tx[], id: string, fields: TxFields, categories: Category[]) =>
  list.map((t) => (t.id === id ? applyFields(t, fields, categories) : t));

const SELECTED_ROW_STYLE = { background: 'color-mix(in srgb, var(--accent) 9%, transparent)' };
const SELECTED_BAR_STYLE = { boxShadow: 'inset 3px 0 0 var(--accent)' };

type UserSettings = {
  baseCurrency: string;
};

const formatCurrency = (amount: number, currency?: string, baseCurrency: string = 'USD') => {
  return formatAmountCompact(amount, currency || 'USD', baseCurrency);
};

function TransactionsPageContent() {
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') || 'all') as 'review' | 'all' | 'subscriptions';

  const [queue, setQueue] = useState<Queue | null>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [pendingCategories, setPendingCategories] = useState<Record<string, string>>({});
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [drawerSnapshot, setDrawerSnapshot] = useState<Tx | null>(null);
  const drawerRef = useRef<TransactionDrawerHandle>(null);
  // An id the drawer asked for that the lists don't hold yet, and the refresh that should bring it.
  const [pendingOpen, setPendingOpen] = useState<{
    id: string;
    opts?: OpenOpts;
    after: number;
  } | null>(null);
  const refreshesStarted = useRef(0);
  const [refreshesDone, setRefreshesDone] = useState(0);
  // Bumped per link request so asking again on the already-open transaction reopens the search.
  const linkRequests = useRef(0);

  // Tag state
  const [availableTags, setAvailableTags] = useState<TagDef[]>([]);

  // Bulk selection state
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [bulkTagAction, setBulkTagAction] = useState<'add' | 'remove'>('add');
  const [bulkTagName, setBulkTagName] = useState<string>('');

  const toggleSelection = (txId: string) => {
    setSelectedTransactions((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) {
        next.delete(txId);
      } else {
        next.add(txId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedTransactions(new Set(transactions.map((tx) => tx.id)));
  };

  const clearSelection = () => {
    setSelectedTransactions(new Set());
  };

  const bulkUpdateCategory = async () => {
    if (!bulkCategory || selectedTransactions.size === 0) return;

    await fetch('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        transactionIds: Array.from(selectedTransactions),
        data: { categoryId: bulkCategory },
      }),
    });

    clearSelection();
    setBulkCategory('');
    refreshTransactionsAndQueue();
    triggerSync();
  };

  const bulkDelete = async () => {
    if (selectedTransactions.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedTransactions.size} transaction${selectedTransactions.size > 1 ? 's' : ''}? This cannot be undone.`
      )
    ) {
      return;
    }

    await fetch('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        transactionIds: Array.from(selectedTransactions),
      }),
    });

    clearSelection();
    refreshTransactionsAndQueue();
    triggerSync();
  };

  const bulkMarkAsTransfer = async () => {
    if (selectedTransactions.size === 0) return;

    await fetch('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        transactionIds: Array.from(selectedTransactions),
        data: { isTransfer: true },
      }),
    });

    clearSelection();
    refreshTransactionsAndQueue();
    triggerSync();
  };

  const bulkUpdateTags = async () => {
    if (!bulkTagName || selectedTransactions.size === 0) return;

    const updates = Array.from(selectedTransactions).map((txId) => {
      const tx = transactions.find((t) => t.id === txId);
      const currentTags = tx?.tags || [];
      const newTags =
        bulkTagAction === 'add'
          ? currentTags.includes(bulkTagName)
            ? currentTags
            : [...currentTags, bulkTagName]
          : currentTags.filter((t) => t !== bulkTagName);
      return { id: txId, tags: newTags };
    });

    const tagGroups = new Map<string, string[]>();
    for (const u of updates) {
      const key = JSON.stringify(u.tags);
      const group = tagGroups.get(key) ?? [];
      group.push(u.id);
      tagGroups.set(key, group);
    }

    await Promise.all(
      Array.from(tagGroups.entries()).map(([tagsJson, ids]) =>
        fetch('/api/transactions/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            transactionIds: ids,
            data: { tags: JSON.parse(tagsJson) },
          }),
        })
      )
    );

    clearSelection();
    setBulkTagName('');
    refreshTransactionsAndQueue();
    triggerSync();
  };

  const createTag = async (name: string): Promise<TagDef | null> => {
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: 'blue' }),
      });
      if (!res.ok) return null;
      const tag = await res.json();
      setAvailableTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      return tag;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadData();
  }, [searchParams]);

  const loadData = async () => {
    const queryParams = new URLSearchParams();
    const preset = searchParams.get('preset');
    const account = searchParams.get('account');
    const category = searchParams.get('category');
    const merchant = searchParams.get('merchant');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const tag = searchParams.get('tag');

    if (preset) queryParams.set('preset', preset);
    if (account) queryParams.set('account', account);
    if (category) queryParams.set('category', category);
    if (merchant) queryParams.set('merchant', merchant);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);
    if (tag) queryParams.set('tag', tag);

    const queryString = queryParams.toString();

    const [queueData, txData, catData, accData, settingsData, tagsData] = await Promise.all([
      fetch('/api/review-queue').then((r) => r.json()),
      fetch(`/api/transactions${queryString ? `?${queryString}` : ''}`).then((r) => r.json()),
      fetch('/api/categories').then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/tags').then((r) => r.json()),
    ]);

    setQueue(queueData);
    setTransactions(txData.transactions ?? []);
    setCategories(catData.categories ?? []);
    setAccounts(accData.accounts ?? []);
    setUserSettings(settingsData.settings ?? null);
    setAvailableTags(tagsData.tags ?? []);
  };

  const refreshTransactionsAndQueue = async () => {
    const seq = ++refreshesStarted.current;
    const queryParams = new URLSearchParams();
    const preset = searchParams.get('preset');
    const account = searchParams.get('account');
    const category = searchParams.get('category');
    const merchant = searchParams.get('merchant');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const tag = searchParams.get('tag');

    if (preset) queryParams.set('preset', preset);
    if (account) queryParams.set('account', account);
    if (category) queryParams.set('category', category);
    if (merchant) queryParams.set('merchant', merchant);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);
    if (tag) queryParams.set('tag', tag);

    const queryString = queryParams.toString();

    try {
      const [queueData, txData] = await Promise.all([
        fetch('/api/review-queue').then((r) => r.json()),
        fetch(`/api/transactions${queryString ? `?${queryString}` : ''}`).then((r) => r.json()),
      ]);
      setQueue(queueData);
      setTransactions(txData.transactions ?? []);
    } catch (err) {
      console.error('Failed to refresh transactions', err);
    } finally {
      // A pending open waits on this count, so a failed refresh must advance it too.
      setRefreshesDone((done) => Math.max(done, seq));
    }
  };

  const setPendingCategory = (transactionId: string, categoryId: string) => {
    setPendingCategories((prev) => ({
      ...prev,
      [transactionId]: categoryId,
    }));
  };

  const setPendingNote = (transactionId: string, note: string) => {
    setPendingNotes((prev) => ({
      ...prev,
      [transactionId]: note,
    }));
  };

  const drawerList = tab === 'review' ? reviewList(queue) : transactions;
  const openId = drawer?.mode === 'edit' ? drawer.id : null;
  const listedTx = openId
    ? (drawerList.find((t) => t.id === openId) ?? transactions.find((t) => t.id === openId))
    : undefined;
  // A refresh can drop the open transaction from every list; the drawer stays on it regardless.
  const drawerTx = listedTx ?? (drawerSnapshot?.id === openId ? drawerSnapshot : null);

  useEffect(() => {
    if (listedTx) setDrawerSnapshot(listedTx);
  }, [listedTx]);

  const isListed = (id: string) =>
    drawerList.some((t) => t.id === id) || transactions.some((t) => t.id === id);

  const editTarget = (id: string, opts?: OpenOpts): DrawerTarget =>
    opts?.startLinking
      ? { mode: 'edit', id, linkRequest: ++linkRequests.current }
      : { mode: 'edit', id };

  // Ids outside the lists (new split parts, an unsplit original, an older refund original)
  // resolve after a refresh or a wider lookup; meanwhile the drawer stays where it is.
  const onDrawerOpen = (id: string, opts?: OpenOpts) => {
    if (drawer?.mode === 'edit' && !isListed(id)) {
      if (refreshesDone >= refreshesStarted.current) void refreshTransactionsAndQueue();
      setPendingOpen({ id, opts, after: refreshesStarted.current });
      return;
    }
    setPendingOpen(null);
    setDrawer(editTarget(id, opts));
  };

  const pendingListed = pendingOpen ? isListed(pendingOpen.id) : false;
  const currentListed = openId ? isListed(openId) : false;
  useEffect(() => {
    if (!pendingOpen) return;
    const { id, opts } = pendingOpen;
    if (pendingListed) {
      setDrawer(editTarget(id, opts));
      setPendingOpen(null);
      return;
    }
    if (refreshesDone < pendingOpen.after) return;
    // Still missing after the refresh: look wider; the snapshot then carries it outside the list.
    let stale = false;
    void fetchLastYear().then((year) => {
      if (stale) return;
      const tx = year?.find((t) => t.id === id);
      if (tx) {
        setDrawerSnapshot(tx);
        setDrawer(editTarget(id, opts));
      } else if (year && !currentListed && !year.some((t) => t.id === openId)) {
        // A miss stays on the current transaction, unless that is gone too (e.g. after unsplit).
        setDrawer(null);
      }
      setPendingOpen(null);
    });
    return () => {
      stale = true;
    };
  }, [pendingOpen, pendingListed, refreshesDone, openId, currentListed]);

  const drawerState =
    drawer?.mode === 'new'
      ? drawer
      : drawer && drawerTx
        ? { mode: 'edit' as const, tx: drawerTx, linkRequest: drawer.linkRequest }
        : null;
  // Layout follows what is shown: an opened id that never loads leaves the page unpushed.
  const drawerOpen = drawerState !== null;

  // Opens go through the drawer so a pending edit is saved before it switches.
  // Clicking the row that is already open closes the drawer.
  const openTransaction = (id: string, opts?: OpenOpts) => {
    if (!opts && drawerState?.mode === 'edit' && drawerState.tx.id === id) {
      void drawerRef.current?.close();
      return;
    }
    void drawerRef.current?.open(id, opts);
  };
  const openNewTransaction = () => void drawerRef.current?.openNew();

  // Applied to the current rows, not the drawer's copy: a queued save may hold a stale one.
  const onRowSaved = (id: string, fields: TxFields) => {
    const patch = (list: Tx[]) => patchRow(list, id, fields, categories);
    setTransactions(patch);
    setQueue(
      (prev) =>
        prev && {
          uncategorized: patch(prev.uncategorized),
          lowConfidence: patch(prev.lowConfidence),
          highConfidence: patch(prev.highConfidence),
          unlinkedReturns: patch(prev.unlinkedReturns),
          outliers: patch(prev.outliers),
        }
    );
    setDrawerSnapshot((prev) => prev && patch([prev])[0]);
  };

  const closeDrawer = () => {
    setPendingOpen(null);
    setDrawer(null);
    refreshTransactionsAndQueue();
  };

  const submitAllCategories = async () => {
    const categoryUpdates = Object.entries(pendingCategories);
    const noteUpdates = Object.entries(pendingNotes);

    if (categoryUpdates.length === 0 && noteUpdates.length === 0) return;

    // Combine category and note updates for each transaction
    const allTransactionIds = new Set([
      ...categoryUpdates.map(([id]) => id),
      ...noteUpdates.map(([id]) => id),
    ]);

    await Promise.all(
      Array.from(allTransactionIds).map((transactionId) => {
        const updateData: any = {};
        if (pendingCategories[transactionId]) {
          updateData.categoryId = pendingCategories[transactionId];
        }
        if (pendingNotes[transactionId] !== undefined) {
          updateData.note = pendingNotes[transactionId];
        }

        return fetch(`/api/transactions/${transactionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
      })
    );

    setPendingCategories({});
    setPendingNotes({});
    refreshTransactionsAndQueue(); // Refresh data to update the review queue
    triggerSync();
  };

  const confirmCategory = async (transactionId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidenceScore: 1.0 }),
      });
      refreshTransactionsAndQueue();
      triggerSync();
    } catch (error) {
      alert('Failed to confirm category');
    }
  };

  const unlinkReturn = async (transactionId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}/returns`, {
        method: 'DELETE',
      });
      refreshTransactionsAndQueue();
      triggerSync();
    } catch (error) {
      alert('Failed to unlink return');
    }
  };

  const approveAllHighConfidence = async () => {
    if (!queue?.highConfidence?.length) return;

    await fetch('/api/transactions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        transactionIds: queue.highConfidence.map((tx) => tx.id),
        data: { confidenceScore: 1.0 },
      }),
    });

    refreshTransactionsAndQueue();
    triggerSync();
  };

  const reviewSection = (title: string, txs: Tx[]) => {
    const isHighConfidence = title.includes('Auto-categorized');

    return (
      <Card key={title}>
        <CardHeader className="flex items-center justify-between">
          <div className={`text-sm font-semibold ${ds.text.primary}`}>{title}</div>
          <div className="flex items-center gap-2">
            <Badge>{txs?.length || 0} items</Badge>
            {isHighConfidence && txs && txs.length > 0 && (
              <Button
                className="text-xs px-3 py-1 bg-[var(--green)] text-white hover:bg-[var(--green)]"
                onClick={approveAllHighConfidence}
              >
                Approve All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {txs?.map((tx) => {
            const hasPendingCategory = pendingCategories[tx.id];
            const selectedCategoryName = hasPendingCategory
              ? categories.find((c) => c.id === hasPendingCategory)?.name
              : null;

            const hasPendingNote = pendingNotes[tx.id] !== undefined;
            const hasPendingChanges = hasPendingCategory || hasPendingNote;

            return (
              <div
                key={tx.id}
                className={cn(
                  `p-4 rounded-lg border ${hasPendingChanges ? `${ds.status.success.border} ${ds.status.success.bg}` : `${ds.border.default} ${ds.bg.primary}`} ${ds.border.hover} hover:shadow-sm transition-all cursor-pointer space-y-3`,
                  openId === tx.id && 'ring-1 ring-[var(--accent)]'
                )}
                onClick={() => openTransaction(tx.id)}
              >
                {/* Transaction Header */}
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${ds.text.primary} truncate`}>
                      {tx.merchant}
                      {tx.parentTransactionId && (
                        <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                          Split
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${ds.text.muted}`}>{tx.date.split('T')[0]}</span>
                      <Badge
                        className="text-xs"
                        tone={tx.confidenceScore < 0.6 ? 'warning' : 'default'}
                      >
                        {(tx.confidenceScore * 100).toFixed(0)}%
                      </Badge>
                      {tx.isOffset && (
                        <Badge
                          className={`text-xs ${ds.status.info.bg} ${ds.status.info.text}`}
                          tone="default"
                        >
                          ↩ Linked
                        </Badge>
                      )}
                      {tx.offsetTransactions && tx.offsetTransactions.length > 0 && (
                        <Badge
                          className={`text-xs ${ds.status.purple.bg} ${ds.status.purple.text}`}
                          tone="default"
                        >
                          Has {tx.offsetTransactions.length} Linked
                        </Badge>
                      )}
                      {tx.category && !hasPendingCategory && (
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${ds.bg.tertiary} ${ds.text.secondary}`}
                        >
                          {tx.category.name}
                        </span>
                      )}
                      {selectedCategoryName && (
                        <span className="text-xs text-[var(--green)] font-medium">
                          → {selectedCategoryName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`font-semibold text-lg tracking-tight font-mono ${ds.text.primary}`}
                    >
                      {formatCurrency(tx.amount, tx.account?.currency, userSettings?.baseCurrency)}
                    </div>
                  </div>
                </div>

                {/* Current Note Display */}
                {tx.note && !hasPendingNote && (
                  <div
                    className={`text-sm ${ds.text.secondary} ${ds.bg.secondary} p-2 rounded border`}
                  >
                    <span
                      className={`text-xs ${ds.text.muted} uppercase tracking-wide font-medium`}
                    >
                      Current Note:
                    </span>
                    <div className="mt-1">{tx.note}</div>
                  </div>
                )}

                {/* Controls */}
                <div
                  className="grid grid-cols-1 gap-3 md:grid-cols-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Category
                    </label>
                    <div className="flex gap-2">
                      <CategorySelect
                        categories={categories}
                        className="flex-1 text-sm"
                        placeholder="Select category..."
                        value={pendingCategories[tx.id] || ''}
                        onChange={(id) => setPendingCategory(tx.id, id ?? '')}
                      />
                      {tx.category && !hasPendingCategory && (
                        <button
                          className="text-[var(--green)] hover:text-[var(--green)] hover:bg-[var(--green)]/10 p-2 rounded-lg transition-colors"
                          title="Confirm this category"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmCategory(tx.id);
                          }}
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M5 13l4 4L19 7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className={`block text-xs font-medium ${ds.text.secondary} mb-1`}>
                      Note (optional)
                    </label>
                    <Input
                      className="w-full text-sm"
                      placeholder="Add a note about this transaction..."
                      value={
                        pendingNotes[tx.id] !== undefined ? pendingNotes[tx.id] : tx.note || ''
                      }
                      onChange={(e) => setPendingNote(tx.id, e.target.value)}
                    />
                  </div>
                </div>

                {/* Offset tracking actions */}
                <div className={`flex items-center gap-2 pt-2 border-t ${ds.border.default}`}>
                  {tx.isOffset && tx.linkedTransactionId && (
                    <div className="flex items-center gap-2 flex-1">
                      <span className={`text-xs ${ds.status.info.text}`}>↩ Linked to original</span>
                      <button
                        className="text-xs text-[var(--red)] hover:text-[var(--red)] underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          unlinkReturn(tx.id);
                        }}
                      >
                        Unlink
                      </button>
                    </div>
                  )}
                  {!tx.isOffset && !tx.isTransfer && (
                    <button
                      className={`text-xs ${ds.status.info.text} hover:${ds.status.info.bg} px-2 py-1 rounded transition-colors`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTransaction(tx.id, { startLinking: true });
                      }}
                    >
                      🔗 Link Transaction
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {(!txs || txs.length === 0) && (
            <div className={`py-8 text-center text-sm ${ds.text.muted}`}>
              {isHighConfidence
                ? 'No recent auto-categorizations to review 🎉'
                : 'Nothing to review 🎉'}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const [selectMode, setSelectMode] = useState(false);

  const transactionTabs = [
    { id: 'all', label: 'All' },
    { id: 'review', label: 'Review' },
    { id: 'subscriptions', label: 'Subscriptions' },
  ] as const;

  return (
    <div className={cn('space-y-4', drawerOpen && DRAWER_PUSH_CLASS)}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Transactions</h1>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-6 text-sm font-medium mb-8 border-b border-[var(--border)] pb-2">
        {transactionTabs.map((t) => (
          <Link
            key={t.id}
            className={cn(
              'pb-2 border-b-2 transition-colors',
              tab === t.id
                ? 'text-[var(--text-primary)] border-[var(--accent)]'
                : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]'
            )}
            href={`/transactions?tab=${t.id}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Suspense fallback={<div className="h-12" />}>
        <FilterRibbon />
      </Suspense>

      {tab === 'review' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {queue && (
            <>
              {reviewSection('Uncategorized', queue.uncategorized)}
              {reviewSection('Low confidence', queue.lowConfidence)}
              {reviewSection('Unlinked Credits (Last 30 days)', queue.unlinkedReturns)}
              {reviewSection('Auto-categorized (Last 7 days)', queue.highConfidence)}
              {reviewSection('Outliers', queue.outliers)}
            </>
          )}

          {(Object.keys(pendingCategories).length > 0 || Object.keys(pendingNotes).length > 0) && (
            <Card className={`lg:col-span-2 ${ds.status.success.border} ${ds.status.success.bg}`}>
              <CardHeader>
                <div className={`text-sm font-semibold ${ds.status.success.text}`}>
                  Ready to submit
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className={`text-sm ${ds.status.success.text}`}>
                  {Object.keys(pendingCategories).length} categorization(s) and{' '}
                  {Object.keys(pendingNotes).length} note(s) ready to submit
                </div>
                <Button
                  className="bg-[var(--green)] text-white hover:bg-[var(--green)] py-3 px-6"
                  onClick={submitAllCategories}
                >
                  Submit All Changes
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === 'all' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className={`text-sm font-semibold ${ds.text.primary}`}>All transactions</div>
            <div className="flex items-center gap-2">
              {selectMode ? (
                <Button
                  className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] py-2 px-4 text-sm"
                  onClick={() => {
                    setSelectMode(false);
                    clearSelection();
                  }}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] py-2 px-4 text-sm"
                  onClick={() => setSelectMode(true)}
                >
                  Select
                </Button>
              )}
              <Button
                className="bg-[var(--accent)] text-white hover:bg-[var(--accent)] py-2 px-4 text-sm"
                onClick={openNewTransaction}
              >
                + New Transaction
              </Button>
            </div>
          </CardHeader>

          {/* Bulk Edit Bar */}
          {selectMode && selectedTransactions.size > 0 && (
            <div className="px-5 py-3 bg-[var(--accent)]/10 border-b border-[var(--accent)]">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-[var(--accent)]">
                  {selectedTransactions.size} selected
                </span>
                <button
                  className="text-xs text-[var(--accent)] hover:underline whitespace-nowrap"
                  onClick={() =>
                    selectedTransactions.size === transactions.length
                      ? clearSelection()
                      : selectAll()
                  }
                >
                  {selectedTransactions.size === transactions.length && transactions.length > 0
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
                <div className="flex items-center gap-2">
                  <CategorySelect
                    categories={categories}
                    className="w-48"
                    placeholder="Set category..."
                    value={bulkCategory}
                    onChange={(id) => setBulkCategory(id ?? '')}
                  />
                  <Button
                    className="!bg-[var(--accent)] hover:!bg-[var(--accent)] text-white py-2 px-3 text-xs"
                    disabled={!bulkCategory}
                    onClick={bulkUpdateCategory}
                  >
                    Apply
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="text-sm border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text-secondary)]"
                    value={bulkTagAction}
                    onChange={(e) => setBulkTagAction(e.target.value as 'add' | 'remove')}
                  >
                    <option value="add">Add Tag</option>
                    <option value="remove">Remove Tag</option>
                  </select>
                  <select
                    className="w-40 text-sm border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text-secondary)]"
                    value={bulkTagName}
                    onChange={(e) => setBulkTagName(e.target.value)}
                  >
                    <option value="">Select tag...</option>
                    {availableTags.map((tag) => (
                      <option key={tag.id} value={tag.name}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    className="!bg-[var(--accent)] hover:!bg-[var(--accent)] text-white py-2 px-3 text-xs"
                    disabled={!bulkTagName}
                    onClick={bulkUpdateTags}
                  >
                    Apply Tag
                  </Button>
                </div>
                <Button
                  className="!bg-[var(--red)] hover:!bg-[var(--red)] text-white py-2 px-3 text-xs"
                  onClick={bulkDelete}
                >
                  Delete ({selectedTransactions.size})
                </Button>
                <button
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline ml-auto"
                  onClick={() => {
                    setSelectMode(false);
                    clearSelection();
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-sm table-fixed">
              <thead className={`text-left ${ds.text.muted}`}>
                <tr>
                  <th className="px-3 py-2 w-[100px]">Date</th>
                  <th className="px-3 py-2">Merchant</th>
                  <th className="px-3 py-2 w-[200px] whitespace-nowrap">Category</th>
                  <th className={cn('px-3 py-2 w-[150px]', drawerOpen && 'hidden')}>Account</th>
                  <th className="px-3 py-2 w-[120px] text-right">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors ${
                      selectMode && selectedTransactions.has(tx.id)
                        ? 'bg-[var(--bg-elevated)]'
                        : tx.isTransfer
                          ? 'bg-[var(--accent)]/5'
                          : tx.isOffset
                            ? 'bg-[var(--accent)]/5'
                            : tx.amount > 0
                              ? 'bg-[var(--green)]/5'
                              : ''
                    }`}
                    style={
                      openId === tx.id
                        ? SELECTED_ROW_STYLE
                        : selectMode && selectedTransactions.has(tx.id)
                          ? SELECTED_BAR_STYLE
                          : undefined
                    }
                    onClick={selectMode ? () => toggleSelection(tx.id) : undefined}
                  >
                    <td
                      className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap"
                      style={openId === tx.id ? SELECTED_BAR_STYLE : undefined}
                      onClick={selectMode ? undefined : () => openTransaction(tx.id)}
                    >
                      {tx.date.split('T')[0]}
                    </td>
                    <td
                      className="px-3 py-2"
                      onClick={selectMode ? undefined : () => openTransaction(tx.id)}
                    >
                      <div className="flex items-center gap-2">
                        {tx.isOffset && <span className="text-[var(--accent)]">↩</span>}
                        <div>
                          <div className="text-[var(--text-primary)]">
                            {tx.merchant}
                            {tx.parentTransactionId && (
                              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                                Split
                              </span>
                            )}
                          </div>
                          {tx.isOffset && tx.linkedTransaction && (
                            <div className="text-xs text-[var(--accent)] mt-0.5">
                              Linked to {tx.linkedTransaction.date.split('T')[0]} transaction
                            </div>
                          )}
                          {!tx.isOffset &&
                            tx.offsetTransactions &&
                            tx.offsetTransactions.length > 0 && (
                              <div className="text-xs text-[var(--accent)] mt-0.5">
                                Linked $
                                {tx.offsetTransactions
                                  .reduce((sum: number, r: any) => sum + Math.abs(r.amount), 0)
                                  .toFixed(2)}
                                {tx.offsetTransactions[0] &&
                                  ` on ${tx.offsetTransactions[0].date.split('T')[0]}`}
                              </div>
                            )}
                          {tx.note && (
                            <div className="text-xs text-[var(--text-muted)] mt-0.5 italic">
                              {tx.note}
                            </div>
                          )}
                          {tx.tags && tx.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {tx.tags.map((tagName: string) => {
                                const tagDef = availableTags.find((t) => t.name === tagName);
                                const tagColor = tagDef?.color || 'gray';
                                const cssVar = `var(--tag-${tagColor})`;
                                return (
                                  <span
                                    key={tagName}
                                    className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                                  >
                                    <span
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: cssVar }}
                                    />
                                    {tagName}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 whitespace-nowrap"
                      onClick={selectMode ? undefined : () => openTransaction(tx.id)}
                    >
                      {tx.isTransfer ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                          Transfer
                        </span>
                      ) : tx.isOffset ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                          Linked
                        </span>
                      ) : tx.category?.name ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                          {tx.category.name}
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--red)]/10 text-[var(--red)]">
                          Uncategorized
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-[var(--text-secondary)] text-sm',
                        drawerOpen && 'hidden'
                      )}
                      onClick={selectMode ? undefined : () => openTransaction(tx.id)}
                    >
                      {tx.account?.name || '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold font-mono ${
                        tx.isTransfer
                          ? 'text-[var(--accent)]'
                          : tx.amount > 0
                            ? 'text-[var(--green)]'
                            : 'text-[var(--red)]'
                      }`}
                      onClick={selectMode ? undefined : () => openTransaction(tx.id)}
                    >
                      {tx.amount > 0 ? '+' : ''}
                      {formatCurrency(tx.amount, tx.account?.currency, userSettings?.baseCurrency)}
                      {!tx.isOffset &&
                        tx.offsetTransactions &&
                        tx.offsetTransactions.length > 0 && (
                          <div className="text-xs text-[var(--text-muted)] font-normal mt-0.5">
                            Net:{' '}
                            {(() => {
                              // Calculate net based on whether linked transactions are same sign or opposite
                              const linkedTotal = tx.offsetTransactions.reduce(
                                (sum: number, r: any) => sum + r.amount,
                                0
                              );
                              const netAmount = tx.amount + linkedTotal;
                              return formatCurrency(
                                netAmount,
                                tx.account?.currency,
                                userSettings?.baseCurrency
                              );
                            })()}
                          </div>
                        )}
                    </td>
                    <td className="w-8" />
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === 'subscriptions' && (
        <SubscriptionsTab accounts={accounts} categories={categories} userSettings={userSettings} />
      )}

      <TransactionDrawer
        ref={drawerRef}
        accounts={accounts}
        availableTags={availableTags}
        baseCurrency={userSettings?.baseCurrency ?? 'USD'}
        categories={categories}
        list={drawerList}
        state={drawerState}
        onChanged={refreshTransactionsAndQueue}
        onClose={closeDrawer}
        onCreateTag={createTag}
        onCreated={closeDrawer}
        onNew={() => {
          setPendingOpen(null);
          setDrawer({ mode: 'new' });
        }}
        onOpen={onDrawerOpen}
        onRowSaved={onRowSaved}
      />
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading transactions...</div>}>
      <TransactionsPageContent />
    </Suspense>
  );
}
