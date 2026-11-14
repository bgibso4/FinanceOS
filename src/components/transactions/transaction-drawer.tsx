'use client';

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Drawer } from '@/components/ui/drawer';
import type { TagDef } from '@/components/tag-input';
import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { ERROR, HINT, errorText, sendJson } from '@/components/investments/editor-kit';
import { triggerSync } from '@/lib/cloud-sync';
import { formatAmountCompact } from '@/lib/currency';
import { DeleteZone } from './delete-zone';
import { DetailsSection } from './details-section';
import { DrawerNav } from './drawer-nav';
import { useNewTransactionForm } from './new-transaction-form';
import { RefundsSection } from './refunds-section';
import { SaveStatus } from './save-status';
import { SplitEditor } from './split-editor';
import { SplitSummary } from './split-summary';
import { signedMoney } from './split-bar';
import { useAutosave } from './use-autosave';
import type { Account, Category, TripOption, Tx, TxFields } from './types';

export type OpenOpts = { startLinking?: boolean };

/** For page-level openers (row clicks, New): each saves the pending edit before switching. */
export type TransactionDrawerHandle = {
  open(id: string, opts?: OpenOpts): Promise<void>;
  openNew(): Promise<void>;
  /** Saves the pending edit, then closes; stays open and answers false if that save fails. */
  close(): Promise<boolean>;
};

/** linkRequest is set, and bumped on each request, when the refunds search should open. */
export type DrawerState = { mode: 'edit'; tx: Tx; linkRequest?: number } | { mode: 'new' } | null;

export type TransactionDrawerProps = {
  state: DrawerState;
  list: Tx[];
  categories: Category[];
  accounts: Account[];
  availableTags: TagDef[];
  baseCurrency: string;
  trips: TripOption[];
  onCreateTag: (name: string) => Promise<TagDef | null>;
  onOpen: (id: string, opts?: OpenOpts) => void;
  /** Called by the handle's openNew once pending edits are saved. */
  onNew: () => void;
  onClose: () => void;
  onRowSaved: (id: string, fields: TxFields) => void;
  onChanged: () => void;
  onCreated: () => void;
};

type Flush = () => Promise<boolean>;
const NOTHING_PENDING: Flush = async () => true;

const isTyping = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]');

function headerAmount(amount: number, currency: string | undefined, baseCurrency: string) {
  if (!currency || currency === baseCurrency) return signedMoney(amount);
  const sign = amount < 0 ? '−' : '+';
  return `${sign}${formatAmountCompact(Math.abs(amount), currency, baseCurrency)}`;
}

export function TransactionDrawer({
  ref,
  ...props
}: TransactionDrawerProps & { ref?: React.Ref<TransactionDrawerHandle> }) {
  const { state, list, onOpen, onNew, onClose } = props;
  const tx = state?.mode === 'edit' ? state.tx : null;
  const index = tx ? list.findIndex((t) => t.id === tx.id) : -1;
  // The open form registers here so header nav and close can await it: EditBody its autosave,
  // NewDrawer its check before discarding.
  const flushRef = useRef<Flush>(NOTHING_PENDING);

  const open = useCallback(
    async (id: string, opts?: OpenOpts) => {
      if (!(await flushRef.current())) return;
      if (opts) onOpen(id, opts);
      else onOpen(id);
    },
    [onOpen]
  );

  const close = useCallback(async () => {
    if (!(await flushRef.current())) return false;
    onClose();
    return true;
  }, [onClose]);

  // Each New starts a blank form; the old one keeps its key while it slides out.
  const [newForm, setNewForm] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      open,
      openNew: async () => {
        if (!(await flushRef.current())) return;
        setNewForm((n) => n + 1);
        onNew();
      },
      close,
    }),
    [open, onNew, close]
  );

  // A save can take the open row out of the list; stepping carries on to the rows it sat between.
  // Those rows being gone too means the list itself changed, so there is nowhere sensible to step.
  const lastPlace = useRef<{ id: string; prevId?: string; nextId?: string } | null>(null);
  if (tx && index >= 0) {
    lastPlace.current = { id: tx.id, prevId: list[index - 1]?.id, nextId: list[index + 1]?.id };
  }
  const place = tx && lastPlace.current?.id === tx.id ? lastPlace.current : null;
  const stepTarget = (delta: -1 | 1) => {
    const id = delta > 0 ? place?.nextId : place?.prevId;
    return id && list.some((t) => t.id === id) ? id : undefined;
  };
  const nav = place && {
    hasPrev: stepTarget(-1) !== undefined,
    hasNext: stepTarget(1) !== undefined,
  };

  const step = async (delta: -1 | 1) => {
    const target = stepTarget(delta);
    if (target) await open(target);
  };

  const stepRef = useRef(step);
  stepRef.current = step;
  const editing = tx !== null;

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      void stepRef.current(e.key === 'ArrowUp' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  // Both stay mounted so either can slide out while the other slides in.
  return (
    <>
      <EditDrawer
        {...props}
        close={close}
        flushRef={flushRef}
        index={index}
        nav={nav}
        open={open}
        step={step}
        tx={tx}
      />
      <NewDrawer
        key={newForm}
        {...props}
        close={close}
        flushRef={flushRef}
        isOpen={state?.mode === 'new'}
      />
    </>
  );
}

function EditDrawer({
  tx,
  index,
  nav,
  step,
  open,
  close,
  flushRef,
  ...props
}: TransactionDrawerProps & {
  tx: Tx | null;
  index: number;
  /** Null for a row that was never on the list, which has no neighbours to step to. */
  nav: { hasPrev: boolean; hasNext: boolean } | null;
  step: (delta: -1 | 1) => Promise<void>;
  open: (id: string) => Promise<void>;
  close: () => void;
  flushRef: React.MutableRefObject<Flush>;
}) {
  const { state, list } = props;
  return (
    <Drawer
      actions={nav && <DrawerNav {...nav} count={list.length} index={index} onStep={step} />}
      headerExtra={
        tx && (
          <div
            className={`mt-1 font-mono text-[20px] ${
              tx.amount > 0 ? 'text-[var(--green)]' : 'text-[var(--text-primary)]'
            }`}
          >
            {headerAmount(tx.amount, tx.account?.currency, props.baseCurrency)}
          </div>
        )
      }
      open={tx !== null}
      subtitle={tx && [tx.date.slice(0, 10), tx.account?.name].filter(Boolean).join(' · ')}
      title={tx?.merchant ?? ''}
      onClose={close}
    >
      {tx && state?.mode === 'edit' && (
        <EditBody
          key={tx.id}
          {...props}
          flushRef={flushRef}
          index={index}
          linkRequest={state.linkRequest}
          open={open}
          tx={tx}
        />
      )}
    </Drawer>
  );
}

function NewDrawer({
  accounts,
  categories,
  availableTags,
  onCreateTag,
  onCreated,
  close,
  flushRef,
  isOpen,
}: TransactionDrawerProps & {
  close: () => void;
  flushRef: React.MutableRefObject<Flush>;
  isOpen: boolean;
}) {
  const { body, footer, confirmLeave } = useNewTransactionForm({
    accounts,
    categories,
    availableTags,
    onCreateTag,
    onCancel: close,
    onCreated,
  });

  // Every way out awaits the flush, so this one gate covers them all.
  useEffect(() => {
    if (!isOpen) return;
    flushRef.current = confirmLeave;
    return () => {
      flushRef.current = NOTHING_PENDING;
    };
  }, [isOpen, confirmLeave, flushRef]);

  return (
    <Drawer
      footer={footer}
      open={isOpen}
      subtitle="Entered by hand"
      title="New transaction"
      onClose={close}
    >
      {body}
    </Drawer>
  );
}

type EditBodyProps = TransactionDrawerProps & {
  tx: Tx;
  index: number;
  linkRequest?: number;
  flushRef: React.MutableRefObject<Flush>;
  open: (id: string) => Promise<void>;
};

function EditBody({
  tx,
  index,
  list,
  categories,
  availableTags,
  baseCurrency,
  trips,
  linkRequest,
  flushRef,
  open,
  onCreateTag,
  onOpen,
  onClose,
  onRowSaved,
  onChanged,
}: EditBodyProps) {
  const [splitting, setSplitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const save = useCallback(
    async (fields: TxFields) => {
      // A changed transfer status drops the old pairing, which sync reads as "already paired".
      const body = 'isTransfer' in fields ? { ...fields, transferGroupId: null } : fields;
      await sendJson(`/api/transactions/${tx.id}`, 'PATCH', body);
      triggerSync();
      onRowSaved(tx.id, fields);
      // Transfer and outside-budget status move the row between totals, so the page reloads.
      if ('isTransfer' in fields || 'isOutsideBudget' in fields) onChanged();
    },
    [tx.id, onRowSaved, onChanged]
  );
  const autosave = useAutosave(save);
  const { flush } = autosave;

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      flushRef.current = NOTHING_PENDING;
    };
  }, [flush, flushRef]);

  const isSplitPart = Boolean(tx.parentTransactionId);
  const canSplit =
    !isSplitPart && !tx.linkedTransactionId && !tx.offsetTransactions?.length && !tx.isSplitParent;

  // Pending edits land first so the split's parts copy the saved merchant, date and note.
  const startSplit = async () => {
    if (await flush()) setSplitting(true);
  };

  const unsplit = async () => {
    const restored = await sendJson<Tx>('/api/transactions/unsplit', 'POST', {
      transactionId: tx.parentTransactionId,
    });
    triggerSync();
    onChanged();
    onOpen(restored.id);
  };

  const remove = async () => {
    setDeleteError(null);
    try {
      await sendJson(`/api/transactions/${tx.id}`, 'DELETE');
      triggerSync();
      // A row outside the current list (index -1) has no neighbours to move to.
      const next = index < 0 ? undefined : (list[index + 1] ?? list[index - 1]);
      onChanged();
      if (next) onOpen(next.id);
      else onClose();
    } catch (err) {
      setDeleteError(errorText(err));
    }
  };

  const splitSlot = splitting ? (
    <SplitEditor
      beforeSave={flush}
      categories={categories}
      tx={tx}
      onCancel={() => setSplitting(false)}
      onSaved={(partIds) => {
        onChanged();
        onOpen(partIds[0]);
      }}
    />
  ) : isSplitPart ? (
    <SplitSummary tx={tx} onUnsplit={unsplit} />
  ) : undefined;

  return (
    <>
      <div className="mb-3">
        <SaveStatus message={autosave.message} status={autosave.status} onRetry={autosave.retry} />
      </div>
      <DetailsSection
        availableTags={availableTags}
        categories={categories}
        splitSlot={splitSlot}
        trips={trips}
        tx={tx}
        onCreateTag={onCreateTag}
        onEdit={autosave.edit}
        onStartSplit={canSplit && !splitting ? startSplit : undefined}
      />
      <RefundsSection
        key={linkRequest ?? 0}
        baseCurrency={baseCurrency}
        currency={tx.account?.currency}
        startOpen={linkRequest !== undefined}
        tx={tx}
        onChanged={onChanged}
        onOpen={(id) => void open(id)}
      />
      <section className={SECTION_CARD}>
        <h3 className={SECTION_HEAD}>Categorization</h3>
        <p className={HINT}>{Math.round(tx.confidenceScore * 100)}% confident</p>
      </section>
      {!isSplitPart && (
        <div className="mt-8 border-t border-[var(--border)] pb-2 pt-6 text-center">
          <DeleteZone onDelete={remove} />
          {deleteError && <p className={ERROR}>{deleteError}</p>}
        </div>
      )}
    </>
  );
}
