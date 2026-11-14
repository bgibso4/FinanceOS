'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { TagInput, type TagDef } from '@/components/tag-input';
import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { FIELD_LABEL, HINT } from '@/components/investments/editor-kit';
import { CategorySelect } from './category-select';
import type { Category, TripOption, Tx, TxFields } from './types';

type Props = {
  tx: Tx;
  categories: Category[];
  availableTags: TagDef[];
  trips: TripOption[];
  onCreateTag: (name: string) => Promise<TagDef | null>;
  onEdit: (f: TxFields, opts?: { immediate?: boolean }) => void;
  splitSlot?: React.ReactNode;
  onStartSplit?: () => void;
};

const SEGMENT =
  'h-9 flex-1 text-sm text-[var(--text-secondary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]';
const SEGMENT_ON =
  'bg-[color-mix(in_srgb,var(--accent)_14%,var(--bg-base))] text-[var(--text-primary)] font-medium';
const SELECT =
  'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const SPLIT_BUTTON =
  'h-10 shrink-0 rounded-lg border border-dashed border-[var(--border-hover)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Trip dates are YYYY-MM-DD strings; read them as UTC so the month never shifts. */
const tripLabel = (t: TripOption) => `${t.name} · ${MONTH_YEAR.format(new Date(t.startDate))}`;

/** Parent remounts with key={tx.id}, so local state is never re-synced mid-edit. */
export function DetailsSection({
  tx,
  categories,
  availableTags,
  trips,
  onCreateTag,
  onEdit,
  splitSlot,
  onStartSplit,
}: Props) {
  const [merchant, setMerchant] = useState(tx.merchant);
  const [amount, setAmount] = useState(tx.amount.toFixed(2));
  const [note, setNote] = useState(tx.note ?? '');
  const [date, setDate] = useState(tx.date.slice(0, 10));
  const [categoryId, setCategoryId] = useState(tx.category?.id ?? '');
  const [tags, setTags] = useState(tx.tags ?? []);
  const [tripId, setTripId] = useState(tx.tripId ?? '');
  const isSplitPart = Boolean(tx.parentTransactionId);
  // The API refuses a trip on a split parent; its parts carry the trips.
  const showTrip = !tx.isSplitParent && (trips.length > 0 || Boolean(tx.tripId));

  // Transfers are already left out of spending, and the API refuses the flag on a split parent.
  const showOutsideBudget = !tx.isTransfer && !tx.isSplitParent;
  const outsideBudget = Boolean(tx.isOutsideBudget);

  const segment = (label: string, isTransfer: boolean) => (
    <button
      aria-pressed={tx.isTransfer === isTransfer}
      className={`${SEGMENT} ${tx.isTransfer === isTransfer ? SEGMENT_ON : ''}`}
      type="button"
      onClick={() => {
        if (tx.isTransfer !== isTransfer) onEdit({ isTransfer }, { immediate: true });
      }}
    >
      {label}
    </button>
  );

  return (
    <section className={SECTION_CARD}>
      <h3 className={SECTION_HEAD}>Details</h3>
      <div className="space-y-4">
        <div>
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)] divide-x divide-[var(--border)]">
            {segment('Transaction', false)}
            {segment('Transfer', true)}
          </div>
          {tx.isTransfer && (
            <p className={HINT}>Money moving between your own accounts, like a card payment.</p>
          )}
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="tx-date">
            Date
          </label>
          <Input
            id="tx-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              // Debounced: a hand-typed year passes through 0002, 0020… on its way.
              if (e.target.value) onEdit({ date: e.target.value });
            }}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="tx-amount">
            Amount
          </label>
          <Input
            id="tx-amount"
            inputMode="decimal"
            readOnly={isSplitPart}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              onEdit({ amount: parseFloat(e.target.value) });
            }}
          />
          {isSplitPart && <p className={HINT}>Unsplit to change amounts</p>}
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="tx-merchant">
            Merchant
          </label>
          <Input
            id="tx-merchant"
            value={merchant}
            onChange={(e) => {
              setMerchant(e.target.value);
              onEdit({ merchant: e.target.value });
            }}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="tx-category">
            Category
          </label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <CategorySelect
                categories={categories}
                id="tx-category"
                value={categoryId}
                onChange={(id) => {
                  setCategoryId(id ?? '');
                  onEdit({ categoryId: id }, { immediate: true });
                }}
              />
            </div>
            {onStartSplit && (
              <button className={SPLIT_BUTTON} type="button" onClick={onStartSplit}>
                ⑂ Split
              </button>
            )}
          </div>
          {tx.isTransfer && (
            <p className={HINT}>
              Transfers are left out of spending totals, so the category isn&apos;t counted.
            </p>
          )}
          {splitSlot}
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="tx-note">
            Note
          </label>
          <textarea
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            id="tx-note"
            placeholder="Add a note about this transaction..."
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              onEdit({ note: e.target.value });
            }}
          />
        </div>
        <div>
          <span className={FIELD_LABEL}>Tags</span>
          <TagInput
            availableTags={availableTags}
            value={tags}
            onChange={(next) => {
              setTags(next);
              onEdit({ tags: next }, { immediate: true });
            }}
            onCreateTag={onCreateTag}
          />
        </div>
        {showTrip && (
          <div>
            <label className={FIELD_LABEL} htmlFor="tx-trip">
              Trip
            </label>
            <select
              className={SELECT}
              id="tx-trip"
              value={tripId}
              onChange={(e) => {
                setTripId(e.target.value);
                onEdit({ tripId: e.target.value || null }, { immediate: true });
              }}
            >
              <option value="">None</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {tripLabel(t)}
                </option>
              ))}
            </select>
          </div>
        )}
        {showOutsideBudget && (
          <div className="border-t border-[var(--border)] pt-3">
            <button
              aria-checked={outsideBudget}
              className={`flex items-center gap-2 text-[13px] hover:text-[var(--text-primary)] ${
                outsideBudget ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
              }`}
              role="checkbox"
              type="button"
              onClick={() => onEdit({ isOutsideBudget: !outsideBudget }, { immediate: true })}
            >
              <span
                aria-hidden="true"
                className={`grid h-3.5 w-3.5 flex-none place-items-center rounded-[4px] border-[1.5px] ${
                  outsideBudget
                    ? 'border-[var(--accent)] bg-[var(--accent)]'
                    : 'border-[var(--text-muted)]'
                }`}
              >
                {outsideBudget && (
                  <svg
                    fill="none"
                    height="9"
                    stroke="white"
                    strokeWidth="2.2"
                    viewBox="0 0 12 12"
                    width="9"
                  >
                    <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              Outside budget
            </button>
            {outsideBudget && <p className={HINT}>Left out of your monthly numbers</p>}
          </div>
        )}
      </div>
    </section>
  );
}
