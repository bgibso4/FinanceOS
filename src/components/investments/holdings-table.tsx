'use client';

import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtMoney, fmtQty, fmtSignedMoney, signedTone } from './format';
import { FlagPill } from './pills';

const GRID = 'grid grid-cols-[1fr_96px_92px_70px] gap-3';

export function HoldingsTable({
  lines,
  multiAccount,
}: {
  lines: HoldingLine[];
  multiAccount: boolean;
}) {
  return (
    <div className="mt-2.5">
      <div
        className={`${GRID} pb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]`}
      >
        <span>Security</span>
        <span className="text-right">Value</span>
        <span className="text-right">Gain</span>
        <span className="text-right">Weight</span>
      </div>
      {lines.map((l, i) => (
        <div
          key={l.key}
          className={`${GRID} py-2 text-xs ${i ? 'border-t border-[var(--border)]' : ''}`}
        >
          <div className="min-w-0">
            <div className="flex items-center">
              <span className="font-mono font-medium text-[var(--text-primary)]">{l.label}</span>
              {multiAccount && l.accountCount > 1 && (
                <span className="ml-1.5 rounded-full border border-[var(--border-hover)] px-1.5 text-[10.5px] text-[var(--text-muted)]">
                  {l.accountCount} accounts
                </span>
              )}
              {l.unpriced && <FlagPill>No price source</FlagPill>}
            </div>
            <div className="truncate text-[11px] text-[var(--text-muted)]">
              {l.quantity != null ? `${fmtQty(l.quantity)} · ${l.name}` : l.name}
            </div>
          </div>
          <span className="text-right font-mono text-[var(--text-primary)]">
            {fmtMoney(l.valueBase)}
          </span>
          <span className={`text-right font-mono ${signedTone(l.gainBase)}`}>
            {l.gainBase == null ? '—' : fmtSignedMoney(l.gainBase)}
          </span>
          <span className="text-right font-mono text-[var(--text-secondary)]">
            {l.weightPct.toFixed(multiAccount ? 1 : 0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
