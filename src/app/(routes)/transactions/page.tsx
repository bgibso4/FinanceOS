'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { ds } from '@/lib/design-system';
import { triggerSync } from '@/lib/cloud-sync';
import { FilterRibbon } from '@/components/filter-ribbon';
import type { TagDef } from '@/components/tag-input';
import { CategorySelect } from '@/components/transactions/category-select';
import { BulkEditBar } from '@/components/transactions/bulk-edit-bar';
import { SubscriptionsTab } from '@/components/subscriptions-tab';
import { postTag } from '@/components/transactions/create-tag';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import { TransactionTable, formatCurrency } from '@/components/transactions/transaction-table';
import { fetchTrips, useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import type { Category, TripOption, Tx } from '@/components/transactions/types';

type Queue = {
  uncategorized: Tx[];
  lowConfidence: Tx[];
  highConfidence: Tx[];
  unlinkedReturns: Tx[];
  outliers: Tx[];
};

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

type UserSettings = {
  baseCurrency: string;
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
  const [trips, setTrips] = useState<TripOption[]>([]);

  // Tag state
  const [availableTags, setAvailableTags] = useState<TagDef[]>([]);

  // Bulk selection state
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());

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

  const createTag = async (name: string): Promise<TagDef | null> => {
    const tag = await postTag(name);
    if (tag)
      setAvailableTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  };

  useEffect(() => {
    void fetchTrips().then((loaded) => loaded && setTrips(loaded));
  }, []);

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

  const loadLists = async () => {
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

    const [queueData, txData] = await Promise.all([
      fetch('/api/review-queue').then((r) => r.json()),
      fetch(`/api/transactions${queryString ? `?${queryString}` : ''}`).then((r) => r.json()),
    ]);
    setQueue(queueData);
    setTransactions(txData.transactions ?? []);
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
  const drawer = useTransactionDrawer({
    list: drawerList,
    lookup: transactions,
    refresh: loadLists,
    categories,
    patchRows: (patch) => {
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
    },
  });
  const { openId, openTransaction } = drawer;
  // Every refresh goes through the drawer's, so a pending open waits on one already running.
  const refreshTransactionsAndQueue = drawer.drawerProps.onChanged;

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
    <div className={cn('space-y-4', drawer.isOpen && DRAWER_PUSH_CLASS)}>
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
                onClick={drawer.openNew}
              >
                + New Transaction
              </Button>
            </div>
          </CardHeader>

          {/* Bulk Edit Bar */}
          {selectMode && selectedTransactions.size > 0 && (
            <BulkEditBar
              availableTags={availableTags}
              categories={categories}
              rows={transactions}
              selected={selectedTransactions}
              trips={trips}
              onClear={clearSelection}
              onDone={() => {
                refreshTransactionsAndQueue();
                triggerSync();
              }}
              onExit={() => {
                setSelectMode(false);
                clearSelection();
              }}
              onSelectAll={selectAll}
            />
          )}

          <CardContent className="overflow-x-auto">
            <TransactionTable
              availableTags={availableTags}
              baseCurrency={userSettings?.baseCurrency ?? 'USD'}
              compact={drawer.isOpen}
              openId={openId}
              rows={transactions}
              select={{
                active: selectMode,
                selected: selectedTransactions,
                toggle: toggleSelection,
              }}
              onOpen={openTransaction}
            />
          </CardContent>
        </Card>
      )}

      {tab === 'subscriptions' && (
        <SubscriptionsTab accounts={accounts} categories={categories} userSettings={userSettings} />
      )}

      <TransactionDrawer
        ref={drawer.ref}
        accounts={accounts}
        availableTags={availableTags}
        baseCurrency={userSettings?.baseCurrency ?? 'USD'}
        categories={categories}
        onCreateTag={createTag}
        {...drawer.drawerProps}
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
