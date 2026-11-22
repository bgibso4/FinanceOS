'use client';

import type { ActivityItem } from '@/lib/investments/activity';
import { fmtDay, fmtMoney, fmtQty, fmtSignedMoney } from './format';

const WITH_ACCOUNT =
  'grid grid-cols-[56px_minmax(150px,1.3fr)_minmax(130px,1fr)_84px_96px_104px] gap-3.5';
const WITHOUT_ACCOUNT = 'grid grid-cols-[56px_minmax(150px,1.5fr)_84px_96px_104px] gap-3.5';
const NUM = 'text-right font-mono';
const DASH = <span className="text-[var(--text-muted)]">—</span>;

/** Kinds whose colour tells them apart at a glance; the rest stay secondary. */
const KIND_TONE: Record<string, string> = {
  Buy: 'text-[var(--tag-blue)]',
  Sell: 'text-[var(--accent)]',
  Dividend: 'text-[var(--green)]',
  'Dividend reinvested': 'text-[var(--green)]',
};

/**
 * Investment activity as a table. With `sourceOf` (the all-accounts view) an Account column
 * names where each event happened.
 */
export function ActivityList({
  items,
  sourceOf,
  emptyText,
}: {
  items: ActivityItem[];
  sourceOf?: (accountId: string) => string | null;
  emptyText: string;
}) {
  if (!items.length) {
    return <p className="mt-2.5 text-xs text-[var(--text-muted)]">{emptyText}</p>;
  }
  const grid = sourceOf ? WITH_ACCOUNT : WITHOUT_ACCOUNT;
  return (
    <div className="mt-2.5 overflow-x-auto">
      <div className="min-w-[620px]" role="table">
        <div
          className={`${grid} pb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]`}
          role="row"
        >
          <span role="columnheader">Date</span>
          <span role="columnheader">Activity</span>
          {sourceOf && <span role="columnheader">Account</span>}
          <span className="text-right" role="columnheader">
            Shares
          </span>
          <span className="text-right" role="columnheader">
            Price
          </span>
          <span className="text-right" role="columnheader">
            Amount
          </span>
        </div>
        {items.map((item) => {
          const { trade, currency } = item;
          return (
            <div
              key={item.id}
              className={`${grid} items-baseline border-t border-[var(--border)] py-2 text-xs`}
              role="row"
            >
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]" role="cell">
                {fmtDay(item.date)}
              </span>
              <span className="min-w-0" role="cell">
                <span
                  className={`mr-2 font-medium ${KIND_TONE[item.kind] ?? 'text-[var(--text-secondary)]'}`}
                >
                  {item.kind}
                </span>
                {item.symbol && (
                  <span className="font-mono font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                    {item.symbol}
                  </span>
                )}
              </span>
              {sourceOf && (
                <span className="truncate text-[var(--text-secondary)]" role="cell">
                  {sourceOf(item.accountId)}
                </span>
              )}
              <span className={`${NUM} text-[var(--text-secondary)]`} role="cell">
                {trade ? fmtQty(trade.quantity) : DASH}
              </span>
              <span className={`${NUM} text-[var(--text-secondary)]`} role="cell">
                {trade ? fmtMoney(trade.price, { cents: true, currency }) : DASH}
              </span>
              <span
                className={`${NUM} ${
                  item.amount < 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
                }`}
                role="cell"
              >
                {fmtSignedMoney(item.amount, { cents: true, currency })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
