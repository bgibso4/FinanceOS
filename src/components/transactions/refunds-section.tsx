'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SECTION_CARD, SECTION_HEAD, SECTION_SUB } from '@/components/investments/account-drawer';
import { ERROR, HINT, errorText, sendJson } from '@/components/investments/editor-kit';
import { triggerSync } from '@/lib/cloud-sync';
import { formatAmountCompact } from '@/lib/currency';
import type { Tx } from './types';

type Match = Tx & { score: number; amountDiff: number; daysDiff: number };

const BUTTON =
  'h-9 rounded-lg border border-[var(--border-hover)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50';
const LINK_BUTTON =
  'mt-2 text-sm text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const INPUT =
  'h-9 min-w-0 flex-1 rounded-lg border border-[var(--border-hover)] bg-transparent px-3 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

const DAY_MS = 1000 * 60 * 60 * 24;
const day = (iso: string) => iso.split('T')[0];

type Props = {
  tx: Tx;
  currency?: string;
  baseCurrency: string;
  startOpen?: boolean;
  onChanged: () => void;
  onOpen: (id: string) => void;
};

export function RefundsSection({
  tx,
  currency,
  baseCurrency,
  startOpen,
  onChanged,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(!!startOpen);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const money = (amount: number) => formatAmountCompact(amount, currency || 'USD', baseCurrency);

  useEffect(() => {
    if (!open || tx.isTransfer) return;
    let stale = false;
    setLoading(true);
    setMatches([]);
    sendJson<{ matches?: Match[] }>(`/api/transactions/${tx.id}/returns`, 'GET')
      .then((data) => !stale && setMatches(data.matches || []))
      .catch((err) => !stale && setError(errorText(err)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [open, tx.id, tx.isTransfer]);

  if (tx.isTransfer) return null;

  // Runs a write; the clicked button stays disabled (keyed by `key`) until it settles.
  const run = async (key: string, action: () => Promise<unknown>) => {
    setPending(key);
    setError(null);
    try {
      await action();
      triggerSync();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  const unlink = (id: string) =>
    run(`unlink-${id}`, () => sendJson(`/api/transactions/${id}/returns`, 'DELETE'));

  const link = (match: Match) =>
    run(`link-${match.id}`, () =>
      sendJson(`/api/transactions/${tx.id}/returns`, 'POST', { originalTransactionId: match.id })
    );

  const search = async () => {
    const term = searchRef.current?.value ?? '';
    if (!term) return;
    setLoading(true);
    setError(null);
    try {
      const data = await sendJson<{ transactions?: Tx[] }>(
        `/api/transactions?merchant=${encodeURIComponent(term)}&preset=last-12-months`,
        'GET'
      );
      setMatches(
        (data.transactions || [])
          .filter((t) => t.id !== tx.id && !t.isOffset && !t.linkedTransactionId)
          .map((t) => ({
            ...t,
            score: 0.5,
            amountDiff: Math.abs(Math.abs(t.amount) - Math.abs(tx.amount)),
            daysDiff: Math.round(
              Math.abs(new Date(t.date).getTime() - new Date(tx.date).getTime()) / DAY_MS
            ),
          }))
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const miniTx = (t: Tx) => (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[var(--text-primary)]">{t.merchant}</div>
        <div className="text-xs text-[var(--text-muted)]">{day(t.date)}</div>
      </div>
      <div className="tabular-nums text-[var(--text-primary)]">{money(t.amount)}</div>
    </div>
  );

  const arrow = (text: string) => (
    <div className="my-1.5 pl-3 text-xs text-[var(--text-muted)]">{text}</div>
  );

  const unlinkButton = (id: string) => (
    <button
      className={BUTTON}
      disabled={pending === `unlink-${id}`}
      type="button"
      onClick={() => unlink(id)}
    >
      Unlink
    </button>
  );

  const errorLine = error && <p className={ERROR}>{error}</p>;

  if (tx.isOffset && tx.linkedTransaction) {
    return (
      <section className={SECTION_CARD}>
        <h3 className={SECTION_HEAD}>
          Refunds & paybacks <span className={SECTION_SUB}>linked</span>
        </h3>
        {miniTx(tx.linkedTransaction)}
        {arrow('↑ paid back by this')}
        {miniTx(tx)}
        <div className="mt-3 flex gap-2">
          <button
            className={BUTTON}
            type="button"
            onClick={() => tx.linkedTransactionId && onOpen(tx.linkedTransactionId)}
          >
            Open the original
          </button>
          {unlinkButton(tx.id)}
        </div>
        {errorLine}
      </section>
    );
  }

  if (tx.offsetTransactions?.length) {
    const net = tx.offsetTransactions.reduce((sum, o) => sum + o.amount, tx.amount);
    return (
      <section className={SECTION_CARD}>
        <h3 className={SECTION_HEAD}>
          Refunds & paybacks <span className={SECTION_SUB}>linked</span>
        </h3>
        {miniTx(tx)}
        {tx.offsetTransactions.map((o) => (
          <div key={o.id}>
            {arrow('↑ paid back by')}
            {miniTx(o)}
            <div className="mt-2">{unlinkButton(o.id)}</div>
          </div>
        ))}
        <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
          Net <span className="tabular-nums">{money(net)}</span>
        </div>
        {errorLine}
      </section>
    );
  }

  return (
    <section className={SECTION_CARD}>
      <h3 className={SECTION_HEAD}>Refunds & paybacks</h3>
      {!open ? (
        <>
          <p className={HINT}>
            {tx.amount > 0
              ? 'A refund or payback? Link it to the purchase it pays back so that purchase nets out.'
              : 'When money comes back for this (a refund, or friends paying you back), link it so the purchase nets out.'}
          </p>
          <button className={LINK_BUTTON} type="button" onClick={() => setOpen(true)}>
            {tx.amount > 0 ? '+ Link to a purchase' : '+ Link a refund or payback'}
          </button>
        </>
      ) : (
        <>
          <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">
            Suggested matches
          </div>
          {loading ? (
            <p className={HINT}>Finding matches…</p>
          ) : matches.length === 0 ? (
            <p className={HINT}>No likely matches found.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {matches.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--text-primary)]">
                      {m.merchant}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {day(m.date)} · {m.daysDiff} days {m.date < tx.date ? 'before' : 'after'}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--text-muted)]">
                    <div className="text-sm tabular-nums text-[var(--text-primary)]">
                      {money(m.amount)}
                    </div>
                    <div>{(m.score * 100).toFixed(0)}% match</div>
                    {m.amountDiff > 0.01 && (
                      <div className="text-[var(--amber,var(--text-muted))]">
                        ${m.amountDiff.toFixed(2)} diff
                      </div>
                    )}
                  </div>
                  <button
                    className={BUTTON}
                    disabled={pending === `link-${m.id}`}
                    type="button"
                    onClick={() => link(m)}
                  >
                    Link
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <input
              ref={searchRef}
              aria-label="Search by merchant"
              className={INPUT}
              placeholder="Search by merchant…"
              type="text"
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <button className={BUTTON} disabled={loading} type="button" onClick={search}>
              Search
            </button>
          </div>
          {errorLine}
          <div className="mt-3">
            <button className={BUTTON} type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
