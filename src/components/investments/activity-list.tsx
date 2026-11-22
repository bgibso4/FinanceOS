'use client';

import { useState } from 'react';
import type { ActivityItem } from '@/lib/investments/activity';
import { DetailSection } from './detail-section';
import { fmtDay, fmtMoney, fmtQty, fmtSignedMoney, signedTone } from './format';
import { HeaderFilter, type FilterOption } from './header-filter';

const WITH_ACCOUNT =
  'grid grid-cols-[56px_112px_minmax(150px,1.2fr)_minmax(150px,1fr)_84px_96px_110px] gap-3.5';
const WITHOUT_ACCOUNT = 'grid grid-cols-[56px_112px_minmax(200px,1.6fr)_84px_96px_110px] gap-3.5';
const NUM = 'text-right font-mono';
const DASH = <span className="text-[var(--text-muted)]">—</span>;
const FIRST_SHOWN = 8;
const MORE_SHOWN = 25;
/** The Security filter's value for cash events, which name no security. */
const NO_SECURITY = '';

/** Kinds whose colour tells them apart at a glance; the rest stay secondary. */
const KIND_TONE: Record<string, string> = {
  Buy: 'text-[var(--tag-blue)]',
  Sell: 'text-[var(--accent)]',
  Dividend: 'text-[var(--green)]',
  'Dividend reinvested': 'text-[var(--green)]',
};
const kindTone = (kind: string) => KIND_TONE[kind] ?? 'text-[var(--text-secondary)]';

type Column = 'kind' | 'security' | 'account';
const VALUE_OF: Record<Column, (i: ActivityItem) => string> = {
  kind: (i) => i.kind,
  security: (i) => i.symbol ?? NO_SECURITY,
  account: (i) => i.accountId,
};
type Filters = Record<Column, ReadonlySet<string>>;
const NO_FILTERS: Filters = { kind: new Set(), security: new Set(), account: new Set() };

const passes = (i: ActivityItem, filters: Filters, except?: Column) =>
  (Object.keys(filters) as Column[]).every(
    (c) => c === except || !filters[c].size || filters[c].has(VALUE_OF[c](i))
  );

/** A column's options, counted against the other columns' filters, most frequent first. */
function optionsFor(
  column: Column,
  items: ActivityItem[],
  filters: Filters,
  labelOf: (value: string) => string
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!passes(i, filters, column)) continue;
    const v = VALUE_OF[column](i);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  for (const v of filters[column]) if (!counts.has(v)) counts.set(v, 0);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, label: labelOf(value) }));
}

/**
 * The Activity section: a table of the range's activity, newest first, with Type, Security and
 * (with `sourceOf`, the all-accounts view) Account filters in the column headers. Filters live
 * as long as this section is mounted; key it by account so switching accounts resets them.
 */
export function ActivitySection({
  items,
  sourceOf,
  emptyText,
  hint,
}: {
  items: ActivityItem[];
  sourceOf?: (accountId: string) => string | null;
  emptyText: string;
  hint: string;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [limit, setLimit] = useState(FIRST_SHOWN);
  const matching = items.filter((i) => passes(i, filters));
  const filtered = Object.values(filters).some((f) => f.size > 0);
  const rows = matching.slice(0, limit);
  const latest = items[0];

  const setFilter = (column: Column) => (next: Set<string>) => {
    setFilters({ ...filters, [column]: next });
    setLimit(FIRST_SHOWN);
  };
  const filter = (column: Column, label: string, labelOf: (v: string) => string) => (
    <HeaderFilter
      label={label}
      optionClass={
        column === 'kind' ? kindTone : column === 'security' ? () => 'font-mono' : undefined
      }
      options={optionsFor(column, items, filters, labelOf)}
      searchable={column === 'security'}
      selected={filters[column]}
      onChange={setFilter(column)}
    />
  );
  const grid = sourceOf ? WITH_ACCOUNT : WITHOUT_ACCOUNT;

  return (
    <DetailSection
      count={filtered ? `${matching.length} of ${items.length}` : items.length}
      extra={
        filtered && (
          <button
            className="shrink-0 text-[11.5px] font-medium text-[var(--accent)] hover:underline"
            type="button"
            onClick={() => {
              setFilters(NO_FILTERS);
              setLimit(FIRST_SHOWN);
            }}
          >
            Clear filters
          </button>
        )
      }
      hint={hint}
      id="activity"
      summary={
        latest
          ? `latest ${fmtDay(latest.date)} · ${[latest.kind, latest.symbol].filter(Boolean).join(' ')}`
          : null
      }
      title="Activity"
    >
      {items.length === 0 ? (
        <p className="mt-2.5 text-xs text-[var(--text-muted)]">{emptyText}</p>
      ) : (
        <>
          <div className="mt-2.5 overflow-x-auto">
            <div className="min-w-[720px]" role="table">
              <div
                className={`${grid} pb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]`}
                role="row"
              >
                <span role="columnheader">Date</span>
                <span role="columnheader">{filter('kind', 'Type', (v) => v)}</span>
                <span role="columnheader">
                  {filter('security', 'Security', (v) => v || 'No security (cash)')}
                </span>
                {sourceOf && (
                  <span role="columnheader">
                    {filter('account', 'Account', (v) => sourceOf(v) ?? 'Unknown account')}
                  </span>
                )}
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
              {rows.map((item) => {
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
                    <span className={`font-medium ${kindTone(item.kind)}`} role="cell">
                      {item.kind}
                    </span>
                    <span className="min-w-0" role="cell">
                      {item.symbol ? (
                        <>
                          <span className="block font-mono font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                            {item.symbol}
                          </span>
                          {item.securityName && (
                            <span className="block truncate text-[11px] text-[var(--text-muted)]">
                              {item.securityName}
                            </span>
                          )}
                        </>
                      ) : (
                        DASH
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
                    <span className={`${NUM} font-semibold ${signedTone(item.amount)}`} role="cell">
                      {fmtSignedMoney(item.amount, { cents: true, currency })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {matching.length === 0 ? (
            <p className="border-t border-[var(--border)] py-4 text-xs text-[var(--text-muted)]">
              No activity matches these filters.
            </p>
          ) : (
            <div className="mt-2.5 flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">
                Showing {rows.length} of {matching.length}
              </span>
              {matching.length > limit && (
                <button
                  className="font-medium text-[var(--accent)] hover:underline"
                  type="button"
                  onClick={() => setLimit(limit + MORE_SHOWN)}
                >
                  Show {Math.min(MORE_SHOWN, matching.length - limit)} more
                </button>
              )}
            </div>
          )}
        </>
      )}
    </DetailSection>
  );
}
