'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { ERROR, HINT, errorText, sendJson } from '@/components/investments/editor-kit';
import { triggerSync } from '@/lib/cloud-sync';
import { CategorySelect } from './category-select';
import { SplitBar, Swatch, signedMoney } from './split-bar';
import type { Category, Tx } from './types';

type Row = { categoryId: string; amount: string; note: string };

type Props = {
  tx: Tx;
  categories: Category[];
  onCancel: () => void;
  onSaved: (partIds: string[]) => void;
  /** Lands pending edits so the parts copy them; false (not saved) aborts the split. */
  beforeSave?: () => Promise<boolean>;
};

const BUTTON =
  'h-10 rounded-lg px-4 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';
const emptyRow = (): Row => ({ categoryId: '', amount: '', note: '' });

/** Splits are not autosaved: nothing is written until Save split. */
export function SplitEditor({ tx, categories, onCancel, onSaved, beforeSave }: Props) {
  const total = Math.abs(tx.amount);
  const [rows, setRows] = useState<Row[]>([
    { categoryId: tx.category?.id ?? '', amount: total.toFixed(2), note: '' },
    emptyRow(),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amounts = rows.map((r) => parseFloat(r.amount));
  const sum = amounts.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0);
  const matches = Math.abs(sum - total) < 0.01;
  const valid = matches && amounts.every((a) => Number.isFinite(a) && a > 0);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    const sign = tx.amount < 0 ? -1 : 1;
    setSaving(true);
    setError(null);
    if (beforeSave && !(await beforeSave())) {
      setSaving(false);
      return;
    }
    try {
      const res = await sendJson<{ parts: { id: string }[] }>('/api/transactions/split', 'POST', {
        transactionId: tx.id,
        parts: rows.map((r, i) => ({
          amount: amounts[i] * sign,
          categoryId: r.categoryId || null,
          note: r.note || null,
        })),
      });
      triggerSync();
      onSaved(res.parts.map((p) => p.id));
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const sumLine = matches
    ? `Adds up to ${signedMoney(tx.amount)} ✓`
    : sum < total
      ? `$${(total - sum).toFixed(2)} left to assign`
      : `$${(sum - total).toFixed(2)} too much`;

  return (
    <section className={SECTION_CARD}>
      <h3 className={SECTION_HEAD}>Split this transaction</h3>
      <SplitBar amounts={amounts.map((a) => (Number.isFinite(a) ? a : 0))} total={total} />
      <div className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Swatch index={i} />
              <div className="min-w-0 flex-1">
                <CategorySelect
                  aria-label={`Part ${i + 1} category`}
                  categories={categories}
                  value={r.categoryId}
                  onChange={(id) => update(i, { categoryId: id ?? '' })}
                />
              </div>
              <Input
                aria-label={`Part ${i + 1} amount`}
                className="w-28"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
              />
              <button
                aria-label={`Remove part ${i + 1}`}
                className="h-8 w-8 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                disabled={rows.length <= 2}
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
            <Input
              aria-label={`Part ${i + 1} note`}
              placeholder="Note (optional)"
              value={r.note}
              onChange={(e) => update(i, { note: e.target.value })}
            />
          </div>
        ))}
      </div>
      <button
        className="mt-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        type="button"
        onClick={() => setRows((rs) => [...rs, emptyRow()])}
      >
        + Add a part
      </button>
      <p className={HINT} role="status">
        {sumLine}
      </p>
      {error && <p className={ERROR}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          className={`${BUTTON} border border-[var(--border-hover)] text-[var(--text-secondary)]`}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`${BUTTON} bg-[var(--accent)] text-white`}
          disabled={!valid || saving}
          type="button"
          onClick={() => void save()}
        >
          Save split
        </button>
      </div>
    </section>
  );
}
