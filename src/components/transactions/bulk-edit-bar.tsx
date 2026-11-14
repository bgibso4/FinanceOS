'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TagDef } from '@/components/tag-input';
import { errorText, sendJson } from '@/lib/send-json';
import { CategorySelect } from './category-select';
import type { Category, TripOption, Tx } from './types';

type Props = {
  selected: Set<string>;
  rows: Tx[];
  categories: Category[];
  availableTags: TagDef[];
  trips: TripOption[];
  onSelectAll: () => void;
  onClear: () => void;
  /** After every successful action, once the selection is cleared: the caller refreshes. */
  onDone: () => void;
  /** The "Done" link: leave selection mode. */
  onExit: () => void;
};

const selectClass =
  'text-sm border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text-secondary)]';
const applyClass = '!bg-[var(--accent)] hover:!bg-[var(--accent)] text-white py-2 px-3 text-xs';

const postBulk = (body: unknown) => sendJson('/api/transactions/bulk', 'POST', body);

export function BulkEditBar({
  selected,
  rows,
  categories,
  availableTags,
  trips,
  onSelectAll,
  onClear,
  onDone,
  onExit,
}: Props) {
  const [category, setCategory] = useState('');
  const [tripId, setTripId] = useState('');
  const [tagAction, setTagAction] = useState<'add' | 'remove'>('add');
  const [tagName, setTagName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ids = Array.from(selected);
  const allSelected = selected.size === rows.length && rows.length > 0;

  /** Runs the requests; on failure shows the route's error and keeps the selection. */
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
      return false;
    }
    onClear();
    onDone();
    return true;
  };

  const update = (data: Record<string, unknown>) =>
    ids.length > 0 && run(() => postBulk({ action: 'update', transactionIds: ids, data }));

  const applyCategory = async () => {
    if (category && (await update({ categoryId: category }))) setCategory('');
  };

  const applyTrip = async () => {
    if (tripId && (await update({ tripId }))) setTripId('');
  };

  const applyTag = async () => {
    if (!tagName || ids.length === 0) return;
    // Rows sharing the same resulting tag list go in one call.
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const current = rows.find((t) => t.id === id)?.tags ?? [];
      const next =
        tagAction === 'add'
          ? current.includes(tagName)
            ? current
            : [...current, tagName]
          : current.filter((t) => t !== tagName);
      const key = JSON.stringify(next);
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    const done = await run(() =>
      Promise.all(
        Array.from(groups.entries()).map(([tagsJson, groupIds]) =>
          postBulk({
            action: 'update',
            transactionIds: groupIds,
            data: { tags: JSON.parse(tagsJson) },
          })
        )
      )
    );
    if (done) setTagName('');
  };

  const remove = async () => {
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}? This cannot be undone.`
      )
    ) {
      return;
    }
    await run(() => postBulk({ action: 'delete', transactionIds: ids }));
  };

  return (
    <div className="px-5 py-3 bg-accent/10 border-b border-[var(--accent)]">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-[var(--accent)]">{selected.size} selected</span>
        <button
          className="text-xs text-[var(--accent)] hover:underline whitespace-nowrap"
          onClick={allSelected ? onClear : onSelectAll}
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <div className="flex items-center gap-2">
          <CategorySelect
            aria-label="Set category"
            categories={categories}
            className="w-48"
            placeholder="Set category..."
            value={category}
            onChange={(id) => setCategory(id ?? '')}
          />
          <Button className={applyClass} disabled={!category} onClick={applyCategory}>
            Apply
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Set trip"
            className={`w-40 ${selectClass}`}
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
          >
            <option value="">Set trip...</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
          <Button className={applyClass} disabled={!tripId} onClick={applyTrip}>
            Apply Trip
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Tag action"
            className={selectClass}
            value={tagAction}
            onChange={(e) => setTagAction(e.target.value as 'add' | 'remove')}
          >
            <option value="add">Add Tag</option>
            <option value="remove">Remove Tag</option>
          </select>
          <select
            aria-label="Tag"
            className={`w-40 ${selectClass}`}
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
          >
            <option value="">Select tag...</option>
            {availableTags.map((tag) => (
              <option key={tag.id} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button className={applyClass} disabled={!tagName} onClick={applyTag}>
            Apply Tag
          </Button>
        </div>
        <Button
          className="!bg-[var(--red)] hover:!bg-[var(--red)] text-white py-2 px-3 text-xs"
          onClick={remove}
        >
          Delete ({selected.size})
        </Button>
        <button
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline ml-auto"
          onClick={onExit}
        >
          Done
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-[var(--red)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
