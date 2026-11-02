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
import type { Account, Category, Tx, TxFields } from './types';

type OpenOpts = { startLinking?: boolean };

/** For page-level openers (row clicks, New): each saves the pending edit before switching. */
export type TransactionDrawerHandle = {
  open(id: string, opts?: OpenOpts): Promise<void>;
  openNew(): Promise<void>;
  /** Saves the pending edit, then closes; stays open if that save fails. */
  close(): Promise<void>;
};

/** linkRequest is set, and bumped on each request, when the refunds search should open. */
export type DrawerState = { mode: 'edit'; tx: Tx; linkRequest?: number } | { mode: 'new' } | null;

type Props = {
  state: DrawerState;
  list: Tx[];
  categories: Category[];
  accounts: Account[];
  availableTags: TagDef[];
  baseCurrency: string;
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
}: Props & { ref?: React.Ref<TransactionDrawerHandle> }) {
  const { state, list, onOpen, onNew, onClose } = props;
  const tx = state?.mode === 'edit' ? state.tx : null;
  const index = tx ? list.findIndex((t) => t.id === tx.id) : -1;
  // EditBody registers its autosave flush here so header nav and close can await it.
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
    if (await flushRef.current()) onClose();
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

  const step = useCallback(
    async (delta: -1 | 1) => {
      const target = index < 0 ? undefined : list[index + delta];
      if (target) await open(target.id);
    },
    [index, list, open]
  );

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
        open={open}
        step={step}
        tx={tx}
      />
      <NewDrawer key={newForm} {...props} close={close} isOpen={state?.mode === 'new'} />
    </>
  );
}

function EditDrawer({
  tx,
  index,
  step,
  open,
  close,
  flushRef,
  ...props
}: Props & {
  tx: Tx | null;
  index: number;
  step: (delta: -1 | 1) => Promise<void>;
  open: (id: string) => Promise<void>;
  close: () => void;
  flushRef: React.MutableRefObject<Flush>;
}) {
  const { state, list } = props;
  return (
    <Drawer
      actions={tx && <DrawerNav count={list.length} index={index} onStep={step} />}
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
  isOpen,
}: Props & { close: () => void; isOpen: boolean }) {
  const { body, footer } = useNewTransactionForm({
    accounts,
    categories,
    availableTags,
    onCreateTag,
    onCancel: close,
    onCreated,
  });
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

type EditBodyProps = Props & {
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
      // Transfer status moves the row between totals, so the whole page needs reloading.
      if ('isTransfer' in fields) onChanged();
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
