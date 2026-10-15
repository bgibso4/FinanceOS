'use client';

import { useState, type ReactNode } from 'react';
import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtMoney, fmtQty, fmtSignedMoney, signedTone } from './format';

/** Names a member account on its sub-line. */
export type AccountLabel = { id: string; name: string; institution: string };

const SINGLE = 'grid grid-cols-[1fr_96px_92px_70px] gap-3';
const MULTI = 'grid grid-cols-[18px_1fr_96px_92px_70px] gap-3';
const MONEY = 'text-right font-mono';

function Figures({
  valueBase,
  gainBase,
  weight,
  currency,
}: {
  valueBase: number;
  gainBase: number | null;
  weight: string;
  currency: string;
}) {
  return (
    <>
      <span className={`${MONEY} text-[var(--text-primary)]`}>
        {fmtMoney(valueBase, { currency })}
      </span>
      <span className={`${MONEY} ${signedTone(gainBase)}`}>
        {gainBase == null ? '—' : fmtSignedMoney(gainBase, { currency })}
      </span>
      <span className={`${MONEY} text-[var(--text-secondary)]`}>{weight}</span>
    </>
  );
}

/**
 * Holdings lines. In the all-accounts view a line held in more than one account is a button with
 * a chevron; opening it lists one sub-line per account. Open lines are kept per line key while
 * this table stays mounted (a range change or reload), and reset when it remounts.
 */
export function HoldingsTable({
  lines,
  multiAccount,
  currency,
  accounts,
}: {
  lines: HoldingLine[];
  multiAccount: boolean;
  /** Base currency of `valueBase` and `gainBase`. */
  currency: string;
  accounts: AccountLabel[];
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const grid = multiAccount ? MULTI : SINGLE;
  const weight = (pct: number) => `${pct.toFixed(multiAccount ? 1 : 0)}%`;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="mt-2.5">
      <div
        className={`${grid} pb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]`}
      >
        {multiAccount && <span />}
        <span>Security</span>
        <span className="text-right">Value</span>
        <span className="text-right">Gain</span>
        <span className="text-right">Weight</span>
      </div>
      {lines.map((l, i) => {
        const expandable = multiAccount && l.accountCount > 1;
        const isOpen = expandable && open.has(l.key);
        const rowClass = `${grid} w-full py-2 text-left text-xs ${
          i ? 'border-t border-[var(--border)]' : ''
        }`;
        const cells: ReactNode = (
          <>
            {multiAccount && (
              <span
                aria-hidden
                className={`inline-block text-[11px] leading-[18px] text-[var(--text-muted)] transition-transform ${
                  isOpen ? 'rotate-90' : ''
                }`}
              >
                {expandable ? '›' : ''}
              </span>
            )}
            <span className="block min-w-0">
              <span className="block font-mono font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {l.label}
              </span>
              <span className="block truncate text-[11px] text-[var(--text-muted)]">
                {l.quantity != null ? `${fmtQty(l.quantity)} · ${l.name}` : l.name}
              </span>
            </span>
            <Figures
              currency={currency}
              gainBase={l.gainBase}
              valueBase={l.valueBase}
              weight={weight(l.weightPct)}
            />
          </>
        );
        return (
          <div key={l.key}>
            {expandable ? (
              <button
                aria-expanded={isOpen}
                className={`${rowClass} hover:bg-[color-mix(in_srgb,var(--bg-elevated)_50%,transparent)]`}
                type="button"
                onClick={() => toggle(l.key)}
              >
                {cells}
              </button>
            ) : (
              <div className={rowClass}>{cells}</div>
            )}
            {isOpen &&
              l.members.map((m) => {
                const account = byId.get(m.accountId);
                const detail = [
                  account?.institution,
                  m.quantity != null ? fmtQty(m.quantity) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div
                    key={m.accountId}
                    className={`${grid} py-1.5 text-[11.5px] text-[var(--text-secondary)]`}
                    data-testid="holding-member"
                  >
                    <span />
                    <span className="block min-w-0 border-l-2 border-[var(--border-hover)] pl-2.5">
                      {account?.name ?? 'Unknown account'}
                      <small className="block truncate text-[10.5px] text-[var(--text-muted)]">
                        {detail}
                      </small>
                    </span>
                    <Figures
                      currency={currency}
                      gainBase={m.gainBase}
                      valueBase={m.valueBase}
                      weight={weight(m.weightPct)}
                    />
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
