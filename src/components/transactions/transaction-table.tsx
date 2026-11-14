'use client';

import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatAmountCompact } from '@/lib/currency';
import { ds } from '@/lib/design-system';
import type { TagDef } from '@/components/tag-input';
import type { Tx } from './types';

const SELECTED_ROW_STYLE = { background: 'color-mix(in srgb, var(--accent) 9%, transparent)' };
const SELECTED_BAR_STYLE = { boxShadow: 'inset 3px 0 0 var(--accent)' };

export const formatCurrency = (amount: number, currency?: string, baseCurrency: string = 'USD') => {
  return formatAmountCompact(amount, currency || 'USD', baseCurrency);
};

type TableContext = {
  openId: string | null;
  compact: boolean;
  baseCurrency: string;
  availableTags: TagDef[];
  onOpen: (id: string) => void;
  select?: { active: boolean; selected: Set<string>; toggle: (id: string) => void };
  /** Extra lines under a row's merchant, e.g. why an import listed it. */
  annotate?: (tx: Tx) => ReactNode;
};

type TransactionTableProps = TableContext & {
  rows: Tx[];
  /** When given, rendered under a heading row per group instead of rows. */
  groups?: { label: string; rows: Tx[] }[];
};

export function TransactionTable({ rows, groups, ...context }: TransactionTableProps) {
  const { compact } = context;
  const renderRows = (list: Tx[]) =>
    list.map((tx) => <TransactionRow key={tx.id} tx={tx} {...context} />);

  return (
    <table className="min-w-full text-sm table-fixed">
      <thead className={`text-left ${ds.text.muted}`}>
        <tr>
          <th className="px-3 py-2 w-[100px]">Date</th>
          <th className="px-3 py-2">Merchant</th>
          <th className="px-3 py-2 w-[200px] whitespace-nowrap">Category</th>
          <th className={cn('px-3 py-2 w-[150px]', compact && 'hidden')}>Account</th>
          <th className="px-3 py-2 w-[120px] text-right">Amount</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        {groups
          ? groups.map((group) => (
              <Fragment key={group.label}>
                <tr>
                  <td
                    className={`bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium uppercase tracking-wide ${ds.text.muted}`}
                    colSpan={compact ? 5 : 6}
                  >
                    {group.label}
                  </td>
                </tr>
                {renderRows(group.rows)}
              </Fragment>
            ))
          : renderRows(rows)}
      </tbody>
    </table>
  );
}

function TransactionRow({
  tx,
  openId,
  compact,
  baseCurrency,
  availableTags,
  onOpen,
  select,
  annotate,
}: TableContext & { tx: Tx }) {
  const selecting = select?.active ?? false;
  const selected = selecting && (select?.selected.has(tx.id) ?? false);
  const open = openId === tx.id;
  const openOnClick = selecting ? undefined : () => onOpen(tx.id);

  return (
    <tr
      aria-selected={open || undefined}
      className={`hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors ${
        selected
          ? 'bg-[var(--bg-elevated)]'
          : tx.isTransfer
            ? 'bg-accent/5'
            : tx.isOffset
              ? 'bg-accent/5'
              : tx.amount > 0
                ? 'bg-green/5'
                : ''
      }`}
      style={open ? SELECTED_ROW_STYLE : selected ? SELECTED_BAR_STYLE : undefined}
      onClick={selecting ? () => select?.toggle(tx.id) : undefined}
    >
      <td
        className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap"
        style={open ? SELECTED_BAR_STYLE : undefined}
        onClick={openOnClick}
      >
        {tx.date.split('T')[0]}
      </td>
      <td className="px-3 py-2" onClick={openOnClick}>
        <div className="flex items-center gap-2">
          {tx.isOffset && <span className="text-[var(--accent)]">↩</span>}
          <div>
            <div className="text-[var(--text-primary)]">
              {tx.merchant}
              {tx.isOutsideBudget && (
                <span className="ml-1.5 text-xs text-[var(--text-muted)]">· Outside budget</span>
              )}
              {tx.parentTransactionId && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-accent/10 text-[var(--accent)] font-medium">
                  Split
                </span>
              )}
            </div>
            {annotate?.(tx)}
            {tx.isOffset && tx.linkedTransaction && (
              <div className="text-xs text-[var(--accent)] mt-0.5">
                Linked to {tx.linkedTransaction.date.split('T')[0]} transaction
              </div>
            )}
            {!tx.isOffset && tx.offsetTransactions && tx.offsetTransactions.length > 0 && (
              <div className="text-xs text-[var(--accent)] mt-0.5">
                Linked $
                {tx.offsetTransactions.reduce((sum, r) => sum + Math.abs(r.amount), 0).toFixed(2)}
                {tx.offsetTransactions[0] && ` on ${tx.offsetTransactions[0].date.split('T')[0]}`}
              </div>
            )}
            {tx.note && (
              <div className="text-xs text-[var(--text-muted)] mt-0.5 italic">{tx.note}</div>
            )}
            {tx.tags && tx.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {tx.tags.map((tagName) => {
                  const tagDef = availableTags.find((t) => t.name === tagName);
                  const tagColor = tagDef?.color || 'gray';
                  const cssVar = `var(--tag-${tagColor})`;
                  return (
                    <span
                      key={tagName}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cssVar }}
                      />
                      {tagName}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap" onClick={openOnClick}>
        {tx.isTransfer ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-[var(--accent)]">
            Transfer
          </span>
        ) : tx.isOffset ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-[var(--accent)]">
            Linked
          </span>
        ) : tx.category?.name ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]">
            {tx.category.name}
          </span>
        ) : (
          <span className="text-xs px-1.5 py-0.5 rounded bg-red/10 text-[var(--red)]">
            Uncategorized
          </span>
        )}
      </td>
      <td
        className={cn('px-3 py-2 text-[var(--text-secondary)] text-sm', compact && 'hidden')}
        onClick={openOnClick}
      >
        {tx.account?.name || '—'}
      </td>
      <td
        className={`px-3 py-2 text-right font-semibold font-mono ${
          tx.isTransfer
            ? 'text-[var(--accent)]'
            : tx.amount > 0
              ? 'text-[var(--green)]'
              : 'text-[var(--red)]'
        }`}
        onClick={openOnClick}
      >
        {tx.amount > 0 ? '+' : ''}
        {formatCurrency(tx.amount, tx.account?.currency, baseCurrency)}
        {!tx.isOffset && tx.offsetTransactions && tx.offsetTransactions.length > 0 && (
          <div className="text-xs text-[var(--text-muted)] font-normal mt-0.5">
            Net:{' '}
            {(() => {
              // Calculate net based on whether linked transactions are same sign or opposite
              const linkedTotal = tx.offsetTransactions.reduce((sum, r) => sum + r.amount, 0);
              const netAmount = tx.amount + linkedTotal;
              return formatCurrency(netAmount, tx.account?.currency, baseCurrency);
            })()}
          </div>
        )}
      </td>
      <td className="w-8" />
    </tr>
  );
}
