'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TagInput, type TagDef } from '@/components/tag-input';
import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { ERROR, FIELD_LABEL, errorText, sendJson } from '@/components/investments/editor-kit';
import { triggerSync } from '@/lib/cloud-sync';
import { localDay } from '@/lib/dates';
import { CategorySelect } from './category-select';
import type { Account, Category } from './types';

type Params = {
  accounts: Account[];
  categories: Category[];
  availableTags: TagDef[];
  onCreateTag: (name: string) => Promise<TagDef | null>;
  onCancel: () => void;
  onCreated: () => void;
};

const BUTTON = 'h-10 px-[18px] text-sm';
const REQUIRED = 'Choose an account, and enter a merchant and amount.';

/** Body and footer are split so the drawer can pin the footer outside its scroll area. */
export function useNewTransactionForm({
  accounts,
  categories,
  availableTags,
  onCreateTag,
  onCancel,
  onCreated,
}: Params): {
  body: React.ReactNode;
  footer: React.ReactNode;
  /** Resolves true to go ahead with leaving; asks first once anything has been entered. */
  confirmLeave: () => Promise<boolean>;
} {
  const [accountId, setAccountId] = useState('');
  const [today] = useState(() => localDay());
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const answerLeave = useRef<((leave: boolean) => void) | null>(null);

  const entered = Boolean(
    accountId || amount || merchant || categoryId || note || tags.length > 0 || date !== today
  );

  const confirmLeave = useCallback(async () => {
    if (!entered) return true;
    // Already asking: the first way out gets the answer.
    if (answerLeave.current) return false;
    setAsking(true);
    return new Promise<boolean>((resolve) => {
      answerLeave.current = resolve;
    });
  }, [entered]);

  const answer = (leave: boolean) => {
    setAsking(false);
    answerLeave.current?.(leave);
    answerLeave.current = null;
  };

  const submit = async () => {
    if (!accountId || !merchant || !Number.isFinite(parseFloat(amount))) {
      setError(REQUIRED);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await sendJson('/api/transactions', 'POST', {
        date,
        amount: parseFloat(amount),
        merchant,
        accountId,
        categoryId: categoryId || null,
        note: note || null,
        tags: tags.length > 0 ? tags : undefined,
      });
      triggerSync();
      onCreated();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const body = (
    <section className={SECTION_CARD}>
      <h3 className={SECTION_HEAD}>Details</h3>
      <div className="space-y-3">
        <div>
          <label className={FIELD_LABEL} htmlFor="new-tx-account">
            Account
          </label>
          <Select
            id="new-tx-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Choose an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="new-tx-date">
            Date
          </label>
          <Input
            id="new-tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="new-tx-amount">
            Amount
          </label>
          <Input
            id="new-tx-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="new-tx-merchant">
            Merchant
          </label>
          <Input
            id="new-tx-merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="new-tx-category">
            Category
          </label>
          <CategorySelect
            categories={categories}
            id="new-tx-category"
            value={categoryId}
            onChange={(id) => setCategoryId(id ?? '')}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="new-tx-note">
            Note
          </label>
          <textarea
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            id="new-tx-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <span className={FIELD_LABEL}>Tags</span>
          <TagInput
            availableTags={availableTags}
            value={tags}
            onChange={setTags}
            onCreateTag={onCreateTag}
          />
        </div>
      </div>
    </section>
  );

  const footer = asking ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <p className="mr-auto text-sm text-[var(--text-primary)]">Discard this transaction?</p>
      <Button className={BUTTON} type="button" variant="ghost" onClick={() => answer(false)}>
        Keep editing
      </Button>
      <Button className={BUTTON} type="button" variant="destructive" onClick={() => answer(true)}>
        Discard
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button className={BUTTON} type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button className={BUTTON} disabled={pending} type="button" onClick={submit}>
          Add transaction
        </Button>
      </div>
    </div>
  );

  return { body, footer, confirmLeave };
}
