'use client';

import React, { useState } from 'react';
import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { ERROR, HINT, errorText } from '@/components/investments/editor-kit';
import { SplitBar, Swatch, signedMoney } from './split-bar';
import type { Tx } from './types';

const BUTTON =
  'h-9 rounded-lg border border-[var(--border-hover)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

export function SplitSummary({ tx, onUnsplit }: { tx: Tx; onUnsplit: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parent = tx.parentTransaction;
  if (!parent) return null;
  const parts = parent.splitParts ?? [];
  const total = Math.abs(parent.amount);

  const unsplit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUnsplit();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <section className={SECTION_CARD}>
      <h3 className={SECTION_HEAD}>Part of a split · {signedMoney(parent.amount)}</h3>
      <SplitBar amounts={parts.map((p) => Math.abs(p.amount))} total={total} />
      <ul className="mt-3 space-y-1.5">
        {parts.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center gap-2 text-sm ${
              p.id === tx.id
                ? 'font-semibold text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <Swatch index={i} />
            <span className="min-w-0 flex-1 truncate">
              {p.category?.name ?? 'Uncategorized'}
              {p.note ? ` · ${p.note}` : ''}
            </span>
            <span className="tabular-nums">{signedMoney(p.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {confirming ? (
          <div>
            <p className={HINT}>Remove the parts and restore the original?</p>
            <div className="mt-2 flex gap-2">
              <button
                className={BUTTON}
                disabled={busy}
                type="button"
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
              <button
                className={`${BUTTON} text-[var(--red)]`}
                disabled={busy}
                type="button"
                onClick={() => void unsplit()}
              >
                Unsplit
              </button>
            </div>
            {error && <p className={ERROR}>{error}</p>}
          </div>
        ) : (
          <button className={BUTTON} type="button" onClick={() => setConfirming(true)}>
            Unsplit · restore the original
          </button>
        )}
      </div>
    </section>
  );
}
