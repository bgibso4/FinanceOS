'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { SettingsFooter, SettingsRow } from '@/components/settings/general/settings-group';
import { BulkEditBar } from '@/components/transactions/bulk-edit-bar';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import { formatCurrency, TransactionTable } from '@/components/transactions/transaction-table';
import type { TripOption, Tx } from '@/components/transactions/types';
import type { DrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { fetchTrips, useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import { triggerSync } from '@/lib/cloud-sync';
import { cn } from '@/lib/cn';
import { fmtCalendarDay, fmtMoment, localDay } from '@/lib/dates';
import { plural } from '@/lib/plural';
import { sendJson } from '@/lib/send-json';
import type { ImportResult, RowNote } from '@/lib/splitwise/importer';

/** An import's result as the route sends it: its transactions arrive as client rows. */
export type ImportView = Omit<ImportResult, 'transactions'> & { transactions: Tx[] };

/** Where the card's routes live. */
export const API = '/api/import/splitwise';

const badgeClass = 'ml-1.5 rounded px-1.5 py-0.5 text-xs font-medium';
const ACCENT_BADGE = `${badgeClass} bg-accent/10 text-[var(--accent)]`;
const MUTED_BADGE = `${badgeClass} bg-[var(--bg-elevated)] text-[var(--text-secondary)]`;

const shortDay = (date: string) => fmtCalendarDay(date, { month: 'short', day: 'numeric' });

/** "Today 3:12 pm", or "Nov 8, 3:12 pm" on a later day. */
function importedAt(iso: string): string {
  return localDay(new Date(iso)) === localDay()
    ? `Today ${fmtMoment(iso)}`
    : fmtMoment(iso, { month: 'short', day: 'numeric' });
}

/** The summary chips: one per non-zero count, in the spec's order. */
function chips(result: ImportView): { text: string; warn?: boolean }[] {
  const c = result.counts;
  return [
    c.new > 0 && {
      text: `${c.new} new${c.payments > 0 ? ` · ${plural(c.payments, 'payment')}` : ''}`,
    },
    c.changed > 0 && { text: `${c.changed} changed` },
    c.deleted > 0 && { text: `${c.deleted} deleted` },
    c.unchanged > 0 && { text: `${c.unchanged} unchanged` },
    c.ignored > 0 && { text: `${c.ignored} deleted by you, ignored` },
    c.skippedByDate > 0 && { text: `${c.skippedByDate} skipped, typed by hand` },
    c.others > 0 && { text: `${c.others} not yours` },
    c.otherCurrency > 0 && { text: `${c.otherCurrency} in another currency` },
    c.needCategory > 0 && { text: `${c.needCategory} need a category`, warn: true },
  ].filter((chip): chip is { text: string; warn?: boolean } => Boolean(chip));
}

/** What Undo will do, in the words of the inline confirm. */
function undoText(result: ImportView): string {
  const created = result.counts.new;
  const putBack = result.notes.filter((n) => n.kind === 'changed' && !n.flag).length;
  const restores = result.deleted.filter((d) => !d.restored).length;
  return [
    `Undo removes the ${plural(created, 'transaction')} this import created`,
    putBack > 0 && `, puts ${plural(putBack, 'changed row')} back to the old amount`,
    restores > 0 && `, and restores ${plural(restores, 'deleted row')}`,
    '. Edits you made to them are lost.',
  ]
    .filter(Boolean)
    .join('');
}

/** Why the import listed a row: its badges, then total cost and Splitwise's category. */
function NoteLine({ note, tx, baseCurrency }: { note: RowNote; tx: Tx; baseCurrency: string }) {
  const money = (v: number) => formatCurrency(v, tx.account?.currency, baseCurrency);
  const badges =
    note.flag === 'deleted-check' ? (
      <span className={MUTED_BADGE}>Deleted in Splitwise · check</span>
    ) : note.kind === 'changed' ? (
      <>
        <span className={ACCENT_BADGE}>Changed in Splitwise</span>
        {note.was !== undefined && !note.flag && (
          <s className="ml-1.5 font-mono text-xs text-[var(--text-muted)]">{money(note.was)}</s>
        )}
        {note.flag === 'check-split' && <span className={MUTED_BADGE}>Check the split</span>}
      </>
    ) : note.kind === 'payment' ? (
      <span className={MUTED_BADGE}>Payment</span>
    ) : (
      <span className={ACCENT_BADGE}>New</span>
    );
  return (
    <div className="mt-0.5 text-xs text-[var(--text-muted)]">
      <div className="-ml-1.5">{badges}</div>
      <div className="mt-0.5">
        {`${money(note.cost)} total`}
        {note.category && ` · ${note.category} in Splitwise`}
      </div>
    </div>
  );
}

/**
 * The card after an import: what it did, the rows it created or changed in the shared table
 * (with the shared drawer and bulk bar), the rows Splitwise deleted, and Undo.
 */
export function ImportResultView({
  result,
  accountName,
  refs,
  busy,
  act,
  update,
  onAnother,
  onUndone,
}: {
  result: ImportView;
  accountName: string;
  refs: DrawerReferenceData;
  busy: boolean;
  /** Runs a request, showing its failure on the card. */
  act: (work: () => Promise<void>) => Promise<void>;
  /** Changes the result held by the card. */
  update: (change: (prev: ImportView) => ImportView) => void;
  onAnother: () => void;
  onUndone: () => void;
}) {
  const [confirmUndo, setConfirmUndo] = useState(false);
  /** Set from the Undo click until the drawer has shut; `busy` covers the request after. */
  const [undoing, setUndoing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [showOthers, setShowOthers] = useState(false);

  useEffect(() => {
    void fetchTrips().then((loaded) => loaded && setTrips(loaded));
  }, []);

  const rows = result.transactions;
  const notes = useMemo(
    () => new Map(result.notes.map((n) => [n.transactionId, n])),
    [result.notes]
  );

  const replaceWith = (next: ImportView) => update(() => next);

  const refresh = () =>
    act(async () => replaceWith(await sendJson<ImportView>(`${API}/${result.importId}`, 'GET')));

  const drawer = useTransactionDrawer({
    list: rows,
    lookup: rows,
    refresh,
    categories: refs.categories,
    patchRows: (patch) => update((prev) => ({ ...prev, transactions: patch(prev.transactions) })),
  });

  const restore = (rowId: string) =>
    act(async () => {
      replaceWith(
        await sendJson<ImportView>(`${API}/${result.importId}/rows/${rowId}/restore`, 'POST')
      );
      triggerSync();
    });

  // Both replace this view, drawer included: close it first so its pending edit saves (a failed
  // save keeps it open, and nothing happens). Undo would otherwise race that save.
  const another = () => void drawer.closeThen(onAnother);
  const undo = async () => {
    if (undoing) return;
    setUndoing(true);
    try {
      await drawer.closeThen(
        () =>
          void act(async () => {
            await sendJson(`${API}/${result.importId}/undo`, 'POST');
            triggerSync();
            onUndone();
          })
      );
    } finally {
      setUndoing(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <div className={cn(drawer.isOpen && DRAWER_PUSH_CLASS)}>
      <SettingsRow
        control={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={another}>
              Import another file
            </Button>
            {result.canUndo && (
              <Button variant="outline" onClick={() => setConfirmUndo(true)}>
                Undo this import
              </Button>
            )}
          </div>
        }
        description={`${importedAt(result.createdAt)} · into ${accountName} · ${
          result.firstImport ? 'first import of this group' : 'compared with your last import'
        }`}
        label={`Imported ${result.group}`}
      />

      {confirmUndo && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-elevated)] px-[18px] py-3 text-sm text-[var(--text-primary)]">
          <span>{undoText(result)}</span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirmUndo(false)}>
              Keep
            </Button>
            <Button disabled={busy || undoing} variant="destructive" onClick={() => void undo()}>
              Undo import
            </Button>
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] px-[18px] py-3">
        <div className="flex flex-wrap gap-2">
          {chips(result).map((chip) => (
            <span
              key={chip.text}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs',
                chip.warn
                  ? 'border-red/30 text-[var(--red)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)]'
              )}
            >
              {chip.text}
            </span>
          ))}
        </div>
        {rows.length > 0 && (
          <Button
            className="px-3 py-1 text-xs"
            variant="outline"
            onClick={selecting ? exitSelect : () => setSelecting(true)}
          >
            {selecting ? 'Done' : 'Select'}
          </Button>
        )}
      </div>

      {selecting && selected.size > 0 && (
        <BulkEditBar
          availableTags={refs.availableTags}
          categories={refs.categories}
          rows={rows}
          selected={selected}
          trips={trips}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            void refresh();
            triggerSync();
          }}
          onExit={exitSelect}
          onSelectAll={() => setSelected(new Set(rows.map((t) => t.id)))}
        />
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto border-t border-[var(--border)] px-1.5 py-1">
          <TransactionTable
            compact
            annotate={(tx) => {
              const note = notes.get(tx.id);
              return note && <NoteLine baseCurrency={refs.baseCurrency} note={note} tx={tx} />;
            }}
            availableTags={refs.availableTags}
            baseCurrency={refs.baseCurrency}
            openId={drawer.openId}
            rows={rows}
            select={{ active: selecting, selected, toggle }}
            onOpen={drawer.openTransaction}
          />
        </div>
      )}

      {result.deleted.length > 0 && (
        <>
          <SettingsFooter>Deleted in Splitwise, so removed here</SettingsFooter>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {result.deleted.map((d) => (
                <tr key={d.rowId}>
                  <td className="whitespace-nowrap px-[18px] py-2 text-[var(--text-muted)]">
                    {shortDay(d.date)}
                  </td>
                  <td className="py-2 text-[var(--text-primary)]">
                    {d.description}
                    {d.category && (
                      <span className="text-[var(--text-muted)]">{` · ${d.category}`}</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono text-[var(--text-secondary)]">
                    {formatCurrency(d.amount, refs.baseCurrency, refs.baseCurrency)}
                  </td>
                  <td className="px-[18px] py-2 text-right">
                    {d.restored ? (
                      <span className="text-xs text-[var(--text-muted)]">Restored</span>
                    ) : (
                      <Button
                        className="px-3 py-1 text-xs"
                        disabled={busy}
                        variant="outline"
                        onClick={() => restore(d.rowId)}
                      >
                        Restore
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {result.others.length > 0 && (
        <>
          <SettingsFooter
            action={
              <button
                className="text-xs text-[var(--text-secondary)] underline"
                type="button"
                onClick={() => setShowOthers((v) => !v)}
              >
                {showOthers ? 'Hide' : 'Show'}
              </button>
            }
          >
            {`${plural(result.others.length, 'row')} ${
              result.others.length === 1 ? "doesn't" : "don't"
            } involve you and weren't imported`}
          </SettingsFooter>
          {showOthers && (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--border)]">
                {result.others.map((o, i) => (
                  <tr key={`${o.date}-${o.description}-${i}`}>
                    <td className="whitespace-nowrap px-[18px] py-2 text-[var(--text-muted)]">
                      {shortDay(o.date)}
                    </td>
                    <td className="py-2 text-[var(--text-primary)]">{o.description}</td>
                    <td className="px-[18px] py-2 text-right font-mono text-[var(--text-secondary)]">
                      {formatCurrency(o.cost, refs.baseCurrency, refs.baseCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <SettingsFooter>
        {'Splitwise shows your balance in this group as '}
        <span className="font-mono">
          {formatCurrency(result.total, refs.baseCurrency, refs.baseCurrency)}
        </span>
      </SettingsFooter>

      <TransactionDrawer ref={drawer.ref} {...refs} {...drawer.drawerProps} />
    </div>
  );
}
