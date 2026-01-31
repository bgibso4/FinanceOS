'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';
import { formatAmountCompact, getCurrencyFlag } from '@/lib/currency';
import { triggerSync } from '@/lib/cloud-sync';
import { TagInput, getTagColors } from '@/components/tag-input';
import type { TagDef } from '@/components/tag-input';

type Tx = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category?: { id: string; name: string } | null;
  account?: { id: string; name: string; currency?: string } | null;
  confidenceScore: number;
  isTransfer: boolean;
  note?: string | null;
  tags?: string[];
  isOffset?: boolean;
  linkedTransactionId?: string | null;
  linkedTransaction?: Tx | null;
  offsetTransactions?: Tx[];
};

type Queue = {
  uncategorized: Tx[];
  lowConfidence: Tx[];
  highConfidence: Tx[];
  unlinkedReturns: Tx[];
  outliers: Tx[];
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

const formatCurrency = (amount: number, currency?: string, baseCurrency: string = 'USD') => {
  return formatAmountCompact(amount, currency || 'USD', baseCurrency);
};

// Strip emojis for sorting purposes
const stripEmojis = (str: string) =>
  str.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '').trim();

const sortByName = (a: { name: string }, b: { name: string }) =>
  stripEmojis(a.name).localeCompare(stripEmojis(b.name));

function TransactionsPageContent() {
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') || 'review') as 'review' | 'all';

  const [queue, setQueue] = useState<Queue | null>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [pendingCategories, setPendingCategories] = useState<Record<string, string>>({});
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Tx | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTransaction, setNewTransaction] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    merchant: '',
    categoryId: '',
    note: '',
    accountId: '',
    tags: [] as string[],
  });
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);

  // Return tracking state
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnTransaction, setReturnTransaction] = useState<Tx | null>(null);
  const [potentialMatches, setPotentialMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

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

    await Promise.all(
      Array.from(selectedTransactions).map((txId) =>
        fetch(`/api/transactions/${txId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryId: bulkCategory }),
        })
      )
    );

    clearSelection();
    setBulkCategory('');
    loadData();
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

    await Promise.all(
      Array.from(selectedTransactions).map((txId) =>
        fetch(`/api/transactions/${txId}`, {
          method: 'DELETE',
        })
      )
    );

    clearSelection();
    loadData();
    triggerSync();
  };

  const bulkMarkAsTransfer = async () => {
    if (selectedTransactions.size === 0) return;

    await Promise.all(
      Array.from(selectedTransactions).map((txId) =>
        fetch(`/api/transactions/${txId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isTransfer: true }),
        })
      )
    );

    clearSelection();
    loadData();
    triggerSync();
  };

  const bulkUpdateTags = async () => {
    if (!bulkTagName || selectedTransactions.size === 0) return;

    await Promise.all(
      Array.from(selectedTransactions).map(async (txId) => {
        const tx = transactions.find((t) => t.id === txId);
        const currentTags = tx?.tags || [];
        let newTags: string[];

        if (bulkTagAction === 'add') {
          newTags = currentTags.includes(bulkTagName) ? currentTags : [...currentTags, bulkTagName];
        } else {
          newTags = currentTags.filter((t) => t !== bulkTagName);
        }

        return fetch(`/api/transactions/${txId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: newTags }),
        });
      })
    );

    clearSelection();
    setBulkTagName('');
    loadData();
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

  const loadData = () => {
    fetch('/api/review-queue')
      .then((r) => r.json())
      .then((d) => setQueue(d));

    // Build query string from search params for filtered transactions
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
    fetch(`/api/transactions${queryString ? `?${queryString}` : ''}`)
      .then((r) => r.json())
      .then((d) => setTransactions(d.transactions ?? []));

    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []));
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []));
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setUserSettings(d.settings ?? null));
    fetch('/api/tags')
      .then((r) => r.json())
      .then((d) => setAvailableTags(d.tags ?? []));
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

  const openEditModal = (transaction: Tx) => {
    setEditingTransaction(transaction);
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingTransaction(null);
  };

  const updateTransaction = async () => {
    if (!editingTransaction) return;

    try {
      await fetch(`/api/transactions/${editingTransaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editingTransaction.date,
          amount: editingTransaction.amount,
          merchant: editingTransaction.merchant,
          categoryId: editingTransaction.category?.id || null,
          note: editingTransaction.note,
          tags: editingTransaction.tags || [],
        }),
      });

      closeEditModal();
      loadData(); // Refresh data
      triggerSync();
    } catch (error) {
      alert('Failed to update transaction');
    }
  };

  const deleteTransaction = async () => {
    if (!editingTransaction) return;

    if (
      !confirm(
        `Are you sure you want to delete this transaction?\n\n${editingTransaction.merchant} - $${Math.abs(editingTransaction.amount).toFixed(2)}\n\nThis cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/transactions/${editingTransaction.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        alert('Failed to delete transaction');
        return;
      }

      closeEditModal();
      loadData(); // Refresh data
      triggerSync();
    } catch (error) {
      alert('Failed to delete transaction');
    }
  };

  const toggleTransfer = async () => {
    if (!editingTransaction) return;

    try {
      await fetch(`/api/transactions/${editingTransaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isTransfer: !editingTransaction.isTransfer,
          transferGroupId: null,
        }),
      });

      setEditingTransaction({
        ...editingTransaction,
        isTransfer: !editingTransaction.isTransfer,
      });

      loadData();
      triggerSync();
    } catch (error) {
      alert('Failed to update transfer status');
    }
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
    loadData(); // Refresh data to update the review queue
    triggerSync();
  };

  const createTransaction = async () => {
    if (!newTransaction.accountId || !newTransaction.merchant || !newTransaction.amount) {
      alert('Please fill in account, merchant, and amount');
      return;
    }

    try {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: newTransaction.date,
          amount: parseFloat(newTransaction.amount),
          merchant: newTransaction.merchant,
          accountId: newTransaction.accountId,
          categoryId: newTransaction.categoryId || null,
          note: newTransaction.note || null,
          tags: newTransaction.tags.length > 0 ? newTransaction.tags : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to create transaction:', error);
        alert(`Failed to create transaction: ${error.error || 'Unknown error'}`);
        return;
      }

      setCreateModalOpen(false);
      setNewTransaction({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        merchant: '',
        categoryId: '',
        note: '',
        accountId: '',
        tags: [],
      });
      loadData();
      triggerSync();
    } catch (error) {
      console.error('Failed to create transaction:', error);
      alert('Failed to create transaction');
    }
  };

  const confirmCategory = async (transactionId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidenceScore: 1.0 }),
      });
      loadData();
      triggerSync();
    } catch (error) {
      alert('Failed to confirm category');
    }
  };

  // Return tracking handlers
  const openReturnModal = async (transaction: Tx) => {
    setReturnTransaction(transaction);
    setReturnModalOpen(true);
    setLoadingMatches(true);
    setPotentialMatches([]);

    try {
      const res = await fetch(`/api/transactions/${transaction.id}/returns`);
      const data = await res.json();
      setPotentialMatches(data.matches || []);
    } catch (error) {
      console.error('Failed to load potential matches:', error);
    } finally {
      setLoadingMatches(false);
    }
  };

  const linkReturn = async (originalTransactionId: string) => {
    if (!returnTransaction) return;

    try {
      await fetch(`/api/transactions/${returnTransaction.id}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalTransactionId }),
      });
      setReturnModalOpen(false);
      loadData();
      triggerSync();
    } catch (error) {
      alert('Failed to link return');
    }
  };

  const unlinkReturn = async (transactionId: string) => {
    try {
      await fetch(`/api/transactions/${transactionId}/returns`, {
        method: 'DELETE',
      });
      loadData();
      triggerSync();
    } catch (error) {
      alert('Failed to unlink return');
    }
  };

  const approveAllHighConfidence = async () => {
    if (!queue?.highConfidence.length) return;

    // For now, we'll just remove them from the review queue by updating their createdAt
    // In a real implementation, you might add an "approved" flag to the schema
    const updates = queue.highConfidence.map((tx) =>
      fetch(`/api/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: tx.note ? `${tx.note} [Approved]` : '[Approved]' }),
      })
    );

    await Promise.all(updates);
    loadData(); // Refresh to remove from high confidence queue
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
                className="text-xs px-3 py-1 bg-green-600 text-white hover:bg-green-700"
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
                className={`p-4 rounded-lg border ${hasPendingChanges ? `${ds.status.success.border} ${ds.status.success.bg}` : `${ds.border.default} ${ds.bg.primary}`} ${ds.border.hover} hover:shadow-sm transition-all cursor-pointer space-y-3`}
                onClick={() => openEditModal(tx)}
              >
                {/* Transaction Header */}
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${ds.text.primary} truncate`}>{tx.merchant}</div>
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
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          → {selectedCategoryName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold text-lg ${ds.text.primary}`}>
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
                      <Select
                        className="flex-1 text-sm"
                        value={pendingCategories[tx.id] || ''}
                        onChange={(e) => setPendingCategory(tx.id, e.target.value)}
                      >
                        <option value="">Select category...</option>
                        {categories
                          .filter((c) => !c.parentId) // Get all groups
                          .sort(sortByName)
                          .map((group) => {
                            const groupCategories = categories
                              .filter((c) => c.parentId === group.id)
                              .sort(sortByName);
                            if (groupCategories.length === 0) return null;

                            return (
                              <optgroup key={group.id} label={group.name}>
                                {groupCategories.map((cat) => (
                                  <option key={cat.id} value={cat.id}>
                                    {cat.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                      </Select>
                      {tx.category && !hasPendingCategory && (
                        <button
                          className="text-green-500 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950 p-2 rounded-lg transition-colors"
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
                        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
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
                        openReturnModal(tx);
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

  return (
    <div className="space-y-4">
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
                  className="bg-green-600 text-white hover:bg-green-700 py-3 px-6"
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
              {selectedTransactions.size > 0 && (
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {selectedTransactions.size} selected
                </span>
              )}
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700 py-2 px-4 text-sm"
                onClick={() => setCreateModalOpen(true)}
              >
                + New Transaction
              </Button>
            </div>
          </CardHeader>

          {/* Bulk Edit Bar */}
          {selectedTransactions.size > 0 && (
            <div className="px-5 py-3 bg-blue-50 dark:bg-blue-500/10 border-b border-blue-200 dark:border-blue-500/30">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                  {selectedTransactions.size} selected
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    className="w-48"
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                  >
                    <option value="">Set category...</option>
                    {categories
                      .filter((c) => !c.parentId)
                      .sort(sortByName)
                      .map((group) => {
                        const groupCategories = categories
                          .filter((c) => c.parentId === group.id)
                          .sort(sortByName);
                        if (groupCategories.length === 0) return null;

                        return (
                          <optgroup key={group.id} label={group.name}>
                            {groupCategories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                  </Select>
                  <Button
                    className="!bg-blue-600 hover:!bg-blue-700 text-white py-2 px-3 text-xs"
                    disabled={!bulkCategory}
                    onClick={bulkUpdateCategory}
                  >
                    Apply
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    value={bulkTagAction}
                    onChange={(e) => setBulkTagAction(e.target.value as 'add' | 'remove')}
                  >
                    <option value="add">Add Tag</option>
                    <option value="remove">Remove Tag</option>
                  </select>
                  <select
                    className="w-40 text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
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
                    className="!bg-indigo-600 hover:!bg-indigo-700 text-white py-2 px-3 text-xs"
                    disabled={!bulkTagName}
                    onClick={bulkUpdateTags}
                  >
                    Apply Tag
                  </Button>
                </div>
                <Button
                  className="!bg-red-600 hover:!bg-red-700 text-white py-2 px-3 text-xs"
                  onClick={bulkDelete}
                >
                  Delete ({selectedTransactions.size})
                </Button>
                <button
                  className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline ml-auto"
                  onClick={clearSelection}
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className={`text-left ${ds.text.muted}`}>
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      checked={
                        selectedTransactions.size === transactions.length && transactions.length > 0
                      }
                      className="rounded"
                      type="checkbox"
                      onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                    />
                  </th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Merchant</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${
                      tx.isTransfer
                        ? 'bg-blue-50/50 dark:bg-blue-500/10'
                        : tx.isOffset
                          ? 'bg-purple-50/50 dark:bg-purple-500/10'
                          : tx.amount > 0
                            ? 'bg-green-50/40 dark:bg-green-500/10'
                            : 'bg-red-50/30 dark:bg-red-500/10'
                    }`}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        checked={selectedTransactions.has(tx.id)}
                        className="rounded"
                        type="checkbox"
                        onChange={() => toggleSelection(tx.id)}
                      />
                    </td>
                    <td
                      className="px-3 py-2 text-slate-500 dark:text-slate-500"
                      onClick={() => openEditModal(tx)}
                    >
                      {tx.date.split('T')[0]}
                    </td>
                    <td className="px-3 py-2" onClick={() => openEditModal(tx)}>
                      <div className="flex items-center gap-2">
                        {tx.isOffset && (
                          <span className="text-purple-700 dark:text-purple-400">↩</span>
                        )}
                        <div>
                          <div className="text-slate-900 dark:text-slate-100">{tx.merchant}</div>
                          {tx.isOffset && tx.linkedTransaction && (
                            <div className="text-xs text-purple-700 dark:text-purple-400 mt-0.5">
                              Linked to {tx.linkedTransaction.date.split('T')[0]} transaction
                            </div>
                          )}
                          {!tx.isOffset &&
                            tx.offsetTransactions &&
                            tx.offsetTransactions.length > 0 && (
                              <div className="text-xs text-purple-700 dark:text-purple-400 mt-0.5">
                                Linked $
                                {tx.offsetTransactions
                                  .reduce((sum: number, r: any) => sum + Math.abs(r.amount), 0)
                                  .toFixed(2)}
                                {tx.offsetTransactions[0] &&
                                  ` on ${tx.offsetTransactions[0].date.split('T')[0]}`}
                              </div>
                            )}
                          {tx.note && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 italic">
                              {tx.note}
                            </div>
                          )}
                          {tx.tags && tx.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {tx.tags.map((tagName: string) => {
                                const tagDef = availableTags.find((t) => t.name === tagName);
                                const colors = getTagColors(tagDef?.color || 'gray');
                                return (
                                  <span
                                    key={tagName}
                                    className={`text-xs px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}
                                  >
                                    {tagName}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2" onClick={() => openEditModal(tx)}>
                      {tx.isTransfer ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400">
                          Transfer
                        </span>
                      ) : tx.isOffset ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400">
                          Linked
                        </span>
                      ) : tx.category?.name ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100">
                          {tx.category.name}
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                          Uncategorized
                        </span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-slate-600 dark:text-slate-400 text-sm"
                      onClick={() => openEditModal(tx)}
                    >
                      {tx.account?.name || '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        tx.isTransfer
                          ? 'text-blue-600 dark:text-blue-400'
                          : tx.amount > 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                      }`}
                      onClick={() => openEditModal(tx)}
                    >
                      {tx.amount > 0 ? '+' : ''}
                      {formatCurrency(tx.amount, tx.account?.currency, userSettings?.baseCurrency)}
                      {!tx.isOffset &&
                        tx.offsetTransactions &&
                        tx.offsetTransactions.length > 0 && (
                          <div className="text-xs text-slate-500 dark:text-slate-500 font-normal mt-0.5">
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

      {/* Transaction Edit Modal */}
      <Modal
        isOpen={editModalOpen}
        title={
          editingTransaction
            ? `Edit Transaction: ${editingTransaction.merchant}`
            : 'Edit Transaction'
        }
        onClose={closeEditModal}
      >
        {editingTransaction && (
          <div className="space-y-6">
            {/* Edit Transaction */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Transaction Details</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                      Date
                    </label>
                    <Input
                      className="w-full"
                      type="date"
                      value={new Date(editingTransaction.date).toISOString().split('T')[0]}
                      onChange={(e) =>
                        setEditingTransaction({
                          ...editingTransaction,
                          date: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                      Amount
                    </label>
                    <Input
                      className="w-full"
                      step="0.01"
                      type="number"
                      value={editingTransaction.amount}
                      onChange={(e) =>
                        setEditingTransaction({
                          ...editingTransaction,
                          amount: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Merchant
                  </label>
                  <Input
                    className="w-full"
                    placeholder="Merchant name"
                    value={editingTransaction.merchant}
                    onChange={(e) =>
                      setEditingTransaction({
                        ...editingTransaction,
                        merchant: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Category
                  </label>
                  <Select
                    className="w-full"
                    value={editingTransaction.category?.id || ''}
                    onChange={(e) => {
                      const selectedCategory = categories.find((c) => c.id === e.target.value);
                      setEditingTransaction({
                        ...editingTransaction,
                        category: selectedCategory || null,
                      });
                    }}
                  >
                    <option value="">No category</option>
                    {categories
                      .filter((c) => !c.parentId) // Get all groups
                      .sort(sortByName)
                      .map((group) => {
                        const groupCategories = categories
                          .filter((c) => c.parentId === group.id)
                          .sort(sortByName);
                        if (groupCategories.length === 0) return null;

                        return (
                          <optgroup key={group.id} label={group.name}>
                            {groupCategories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                  </Select>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
                    Account
                  </label>
                  <Input
                    disabled
                    className="w-full !bg-slate-100 dark:!bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed opacity-75"
                    value={editingTransaction.account?.name || 'Unknown'}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Note
                  </label>
                  <Input
                    className="w-full"
                    placeholder="Add a note about this transaction..."
                    value={editingTransaction.note || ''}
                    onChange={(e) =>
                      setEditingTransaction({
                        ...editingTransaction,
                        note: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
                    Tags
                  </label>
                  <TagInput
                    availableTags={availableTags}
                    value={editingTransaction.tags || []}
                    onChange={(tags) => setEditingTransaction({ ...editingTransaction, tags })}
                    onCreateTag={createTag}
                  />
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                  onClick={updateTransaction}
                >
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Transaction Info */}
            <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
              <h4 className={`font-semibold ${ds.text.primary} mb-3`}>Transaction Info</h4>
              <div className={`text-sm ${ds.text.secondary} space-y-1`}>
                <div>
                  <strong>Confidence Score:</strong>{' '}
                  {(editingTransaction.confidenceScore * 100).toFixed(0)}%
                </div>
                <div>
                  <strong>Created:</strong> {editingTransaction.date.split('T')[0]}
                </div>
              </div>
            </div>

            {/* Transfer Status */}
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
              <h4 className="font-semibold text-blue-700 dark:text-blue-400 mb-3">
                Transfer Status
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${ds.text.secondary}`}>
                    {editingTransaction.isTransfer
                      ? 'This transaction is marked as a transfer between accounts'
                      : 'This transaction counts toward spending/income totals'}
                  </span>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      editingTransaction.isTransfer
                        ? `${ds.status.info.bg} ${ds.status.info.text}`
                        : `${ds.bg.tertiary} ${ds.text.secondary}`
                    }`}
                  >
                    {editingTransaction.isTransfer ? 'Transfer' : 'Normal'}
                  </span>
                </div>
                <Button
                  className="w-full py-3 !bg-blue-600 hover:!bg-blue-700 text-white"
                  onClick={toggleTransfer}
                >
                  {editingTransaction.isTransfer ? 'Unmark as Transfer' : 'Mark as Transfer'}
                </Button>
                <div className={`text-xs ${ds.text.muted}`}>
                  {editingTransaction.isTransfer
                    ? 'Unmarking will include this in spending/income calculations'
                    : 'Transfers (like credit card payments) are excluded from spending totals'}
                </div>
              </div>
            </div>

            {/* Linked Transaction Tracking */}
            {!editingTransaction.isTransfer && (
              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <h4 className="font-semibold text-purple-700 dark:text-purple-400 mb-3">
                  Linked Transactions
                </h4>
                {editingTransaction.isOffset && editingTransaction.linkedTransactionId ? (
                  <div className="space-y-3">
                    <div
                      className={`text-sm ${ds.status.purple.text} ${ds.status.purple.bg} p-3 rounded border ${ds.status.purple.border}`}
                    >
                      ↩ This transaction is linked to an original transaction
                    </div>
                    {editingTransaction.linkedTransaction && (
                      <div
                        className={`${ds.bg.primary} p-3 rounded border ${ds.status.purple.border}`}
                      >
                        <div className={`text-sm font-medium ${ds.text.primary} mb-2`}>
                          Original Transaction:
                        </div>
                        <div className={`text-sm ${ds.text.primary}`}>
                          <div>
                            <strong>Merchant:</strong>{' '}
                            {editingTransaction.linkedTransaction.merchant}
                          </div>
                          <div>
                            <strong>Amount:</strong> $
                            {Math.abs(editingTransaction.linkedTransaction.amount).toFixed(2)}
                          </div>
                          <div>
                            <strong>Date:</strong>{' '}
                            {editingTransaction.linkedTransaction.date.split('T')[0]}
                          </div>
                        </div>
                        <Button
                          className="w-full mt-3 !bg-purple-600 hover:!bg-purple-700 py-2 text-sm text-white"
                          onClick={async () => {
                            closeEditModal();
                            // Fetch the full transaction with relations
                            const res = await fetch(`/api/transactions?preset=last-12-months`);
                            const data = await res.json();
                            const fullTx = data.transactions.find(
                              (t: Tx) => t.id === editingTransaction.linkedTransactionId
                            );
                            if (fullTx) {
                              openEditModal(fullTx);
                            }
                          }}
                        >
                          View Original Transaction
                        </Button>
                      </div>
                    )}
                    <Button
                      className="w-full !bg-purple-600 hover:!bg-purple-700 py-3 text-white"
                      onClick={() => {
                        unlinkReturn(editingTransaction.id);
                        closeEditModal();
                      }}
                    >
                      Unlink Transaction
                    </Button>
                  </div>
                ) : editingTransaction.offsetTransactions &&
                  editingTransaction.offsetTransactions.length > 0 ? (
                  <div className="space-y-3">
                    <div
                      className={`text-sm ${ds.status.purple.text} ${ds.status.purple.bg} p-3 rounded border ${ds.status.purple.border}`}
                    >
                      This transaction has {editingTransaction.offsetTransactions.length} linked
                      transaction{editingTransaction.offsetTransactions.length > 1 ? 's' : ''}
                    </div>
                    {editingTransaction.offsetTransactions.map((ret: any) => (
                      <div
                        key={ret.id}
                        className={`flex items-center justify-between p-2 ${ds.bg.primary} rounded border`}
                      >
                        <div className="text-sm">
                          <div className="font-medium">
                            ${Math.abs(ret.amount).toFixed(2)} linked
                          </div>
                          <div className={`text-xs ${ds.text.muted}`}>{ret.date.split('T')[0]}</div>
                        </div>
                        <button
                          className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
                          onClick={() => {
                            unlinkReturn(ret.id);
                            closeEditModal();
                          }}
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button
                    className="w-full !bg-purple-600 hover:!bg-purple-700 py-3 text-white"
                    onClick={() => {
                      closeEditModal();
                      openReturnModal(editingTransaction);
                    }}
                  >
                    🔗 Link Transaction
                  </Button>
                )}
              </div>
            )}

            {/* Delete Transaction */}
            <div className="bg-red-50 dark:bg-slate-900 rounded-lg p-4 border border-red-200 dark:border-slate-700 mb-2">
              <h4 className="font-semibold text-red-700 dark:text-red-400 mb-3">
                Delete Transaction
              </h4>
              <Button
                className="w-full !bg-red-600 text-white hover:!bg-red-700 py-3"
                onClick={deleteTransaction}
              >
                Delete Transaction
              </Button>
              <div className={`text-sm ${ds.status.error.text} mt-2`}>
                <strong>Warning:</strong> This action cannot be undone
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Transaction Modal */}
      <Modal
        isOpen={createModalOpen}
        title="New Transaction"
        onClose={() => setCreateModalOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Date</label>
              <Input
                className="w-full"
                type="date"
                value={newTransaction.date}
                onChange={(e) => setNewTransaction({ ...newTransaction, date: e.target.value })}
              />
            </div>
            <div>
              <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Amount</label>
              <Input
                className="w-full"
                placeholder="-50.00 or 100.00"
                step="0.01"
                type="number"
                value={newTransaction.amount}
                onChange={(e) => setNewTransaction({ ...newTransaction, amount: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Account</label>
            <Select
              className="w-full"
              value={newTransaction.accountId}
              onChange={(e) => setNewTransaction({ ...newTransaction, accountId: e.target.value })}
            >
              <option value="">Select account...</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>Merchant</label>
            <Input
              className="w-full"
              placeholder="e.g., Starbucks, Amazon, etc."
              value={newTransaction.merchant}
              onChange={(e) => setNewTransaction({ ...newTransaction, merchant: e.target.value })}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Category (optional)
            </label>
            <Select
              className="w-full"
              value={newTransaction.categoryId}
              onChange={(e) => setNewTransaction({ ...newTransaction, categoryId: e.target.value })}
            >
              <option value="">No category</option>
              {categories
                .filter((c) => !c.parentId)
                .sort(sortByName)
                .map((group) => {
                  const groupCategories = categories
                    .filter((c) => c.parentId === group.id)
                    .sort(sortByName);
                  if (groupCategories.length === 0) return null;

                  return (
                    <optgroup key={group.id} label={group.name}>
                      {groupCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
            </Select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Note (optional)
            </label>
            <Input
              className="w-full"
              placeholder="Add a note..."
              value={newTransaction.note}
              onChange={(e) => setNewTransaction({ ...newTransaction, note: e.target.value })}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${ds.text.primary} mb-1`}>
              Tags (optional)
            </label>
            <TagInput
              availableTags={availableTags}
              value={newTransaction.tags}
              onChange={(tags) => setNewTransaction({ ...newTransaction, tags })}
              onCreateTag={createTag}
            />
          </div>

          <div className={`text-xs ${ds.text.muted} ${ds.bg.secondary} p-3 rounded border`}>
            Use negative amounts for expenses (e.g., -50.00) and positive for income (e.g., 100.00)
          </div>

          <Button
            className="w-full bg-blue-600 text-white hover:bg-blue-700 py-3"
            onClick={createTransaction}
          >
            Create Transaction
          </Button>
        </div>
      </Modal>

      {/* Link Transaction Modal */}
      <Modal
        isOpen={returnModalOpen}
        title={
          returnTransaction ? `Link Transaction: ${returnTransaction.merchant}` : 'Link Transaction'
        }
        onClose={() => setReturnModalOpen(false)}
      >
        {returnTransaction && (
          <div className="space-y-4">
            <div className={`${ds.status.info.bg} p-4 rounded-lg border ${ds.status.info.border}`}>
              <div className={`text-sm font-semibold ${ds.status.info.text} mb-2`}>
                {returnTransaction.amount > 0 ? 'Credit/Offset' : 'Purchase/Expense'} Transaction
              </div>
              <div className={`text-sm ${ds.text.primary}`}>
                <div>
                  <strong>Merchant:</strong> {returnTransaction.merchant}
                </div>
                <div>
                  <strong>Amount:</strong> ${Math.abs(returnTransaction.amount).toFixed(2)}
                </div>
                <div>
                  <strong>Date:</strong> {returnTransaction.date.split('T')[0]}
                </div>
              </div>
            </div>

            {loadingMatches ? (
              <div className={`text-center py-8 ${ds.text.muted}`}>
                <div className="animate-pulse">Finding potential matches...</div>
              </div>
            ) : (
              <>
                {potentialMatches.length > 0 && (
                  <div className="space-y-3">
                    <div className={`text-sm font-semibold ${ds.text.primary}`}>
                      Suggested Matches ({potentialMatches.length})
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {potentialMatches.map((match) => (
                        <div
                          key={match.id}
                          className={`p-3 border ${ds.border.default} rounded-lg hover:${ds.status.info.border} hover:${ds.status.info.bg} transition-all cursor-pointer`}
                          onClick={() => linkReturn(match.id)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className={`font-medium ${ds.text.primary} truncate`}>
                                {match.merchant}
                              </div>
                              <div className={`text-xs ${ds.text.muted} mt-1`}>
                                {match.date.split('T')[0]} • {match.daysDiff} days{' '}
                                {match.date < returnTransaction.date ? 'before' : 'after'}
                              </div>
                              {match.note && (
                                <div className={`text-xs ${ds.text.secondary} mt-1 truncate`}>
                                  {match.note}
                                </div>
                              )}
                            </div>
                            <div className="text-right ml-3">
                              <div className={`font-semibold ${ds.text.primary}`}>
                                ${Math.abs(match.amount).toFixed(2)}
                              </div>
                              <div className={`text-xs ${ds.text.muted} mt-1`}>
                                {(match.score * 100).toFixed(0)}% match
                              </div>
                              {match.amountDiff > 0.01 && (
                                <div className={`text-xs ${ds.status.warning.text} mt-1`}>
                                  ${match.amountDiff.toFixed(2)} diff
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual search section */}
                <div className={`border-t ${ds.border.default} pt-4`}>
                  <div className={`text-sm font-semibold ${ds.text.primary} mb-3`}>
                    {potentialMatches.length > 0
                      ? "Can't find it? Search manually"
                      : 'Search for Transaction'}
                  </div>
                  <div className="space-y-3">
                    <Input
                      className="w-full"
                      id="manual-search-input"
                      placeholder="Search by merchant name..."
                      type="text"
                    />
                    <Button
                      className="w-full bg-slate-600 hover:bg-slate-700 py-2"
                      onClick={async () => {
                        const searchInput = document.getElementById(
                          'manual-search-input'
                        ) as HTMLInputElement;
                        const searchTerm = searchInput?.value || '';

                        if (!searchTerm) {
                          alert('Please enter a search term');
                          return;
                        }

                        setLoadingMatches(true);
                        try {
                          const res = await fetch(
                            `/api/transactions?merchant=${encodeURIComponent(searchTerm)}&preset=last-12-months`
                          );
                          const data = await res.json();
                          const filtered = (data.transactions || []).filter(
                            (t: any) =>
                              t.id !== returnTransaction.id && !t.isOffset && !t.linkedTransactionId
                            // Removed opposite sign requirement - allow linking any transactions
                          );
                          setPotentialMatches(
                            filtered.map((t: any) => ({
                              ...t,
                              score: 0.5,
                              amountDiff: Math.abs(
                                Math.abs(t.amount) - Math.abs(returnTransaction.amount)
                              ),
                              daysDiff: Math.round(
                                Math.abs(
                                  new Date(t.date).getTime() -
                                    new Date(returnTransaction.date).getTime()
                                ) /
                                  (1000 * 60 * 60 * 24)
                              ),
                            }))
                          );
                        } catch (error) {
                          alert('Search failed');
                        } finally {
                          setLoadingMatches(false);
                        }
                      }}
                    >
                      Search
                    </Button>
                  </div>
                </div>

                {potentialMatches.length === 0 && !loadingMatches && (
                  <div className={`text-center py-4 ${ds.text.muted} text-sm`}>
                    No matches found. Try searching manually above.
                  </div>
                )}

                <div className={`text-xs ${ds.text.muted} ${ds.bg.secondary} p-3 rounded border`}>
                  Click a transaction to link it. Credits reduce expenses (returns, reimbursements,
                  splits, etc.)
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
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
