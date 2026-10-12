'use client';

import type { ActivityItem } from '@/lib/investments/activity';
import { fmtDay, fmtMoney, fmtQty } from './format';

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
    return <p className="mt-1.5 text-xs text-[var(--text-muted)]">{emptyText}</p>;
  }
  return (
    <div className="mt-1.5">
      {items.map((item, i) => {
        const { trade, currency } = item;
        const detail =
          trade &&
          `${fmtQty(trade.quantity)} sh @ ${fmtMoney(trade.price, { cents: true, currency })}`;
        const sub = [sourceOf?.(item.accountId), detail].filter(Boolean).join(' · ');
        return (
          <div
            key={item.id}
            className={`grid grid-cols-[44px_1fr_auto] items-baseline gap-2.5 py-[7px] text-xs ${
              i ? 'border-t border-[var(--border)]' : ''
            }`}
          >
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
              {fmtDay(item.date)}
            </span>
            <div className="min-w-0">
              <div className="text-[var(--text-primary)]">{item.title}</div>
              {sub && <small className="block text-[11px] text-[var(--text-muted)]">{sub}</small>}
            </div>
            <span
              className={`font-mono ${
                item.amount < 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
              }`}
            >
              {fmtMoney(item.amount, { cents: true, currency })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
