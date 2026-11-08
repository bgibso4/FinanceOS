'use client';

import { COMPARE_SHORT, periodLabel } from '@/lib/analytics-period';
import { capped, type AnalyticsQuery } from '@/lib/analytics-query';

type FilterChipsProps = {
  query: AnalyticsQuery;
  /** Names of the category picks, in order (a fully ticked group is one name). */
  categoryNames: string[];
  /** Names of the picked accounts, in order. */
  accountNames: string[];
  onChange(q: AnalyticsQuery): void;
};

type Chip = { kind: string; text: string; clear?: Partial<AnalyticsQuery> };

/** Period and comparison always, then one capped chip per filter in use, each with ✕. */
export function FilterChips({ query, categoryNames, accountNames, onChange }: FilterChipsProps) {
  const chips: Chip[] = [
    { kind: 'Period', text: periodLabel(query.period) },
    { kind: 'vs', text: COMPARE_SHORT[query.vs] },
  ];
  if (query.categories.length)
    chips.push({ kind: 'Category', text: capped(categoryNames), clear: { categories: [] } });
  if (query.accounts.length)
    chips.push({ kind: 'Account', text: capped(accountNames), clear: { accounts: [] } });
  if (query.tags.length) chips.push({ kind: 'Tag', text: capped(query.tags), clear: { tags: [] } });
  if (query.merchant)
    chips.push({ kind: 'Merchant', text: `contains “${query.merchant}”`, clear: { merchant: '' } });

  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
      {chips.map(({ kind, text, clear }) => (
        <li
          key={kind}
          className={`inline-flex max-w-[340px] items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-[var(--accent)]/30 bg-[var(--accent)]/10 py-[5px] pl-[11px] text-[13px] text-[var(--text-primary)] ${
            clear ? 'pr-[5px]' : 'pr-[11px]'
          }`}
        >
          <span className="truncate">
            <span className="text-[var(--text-secondary)]">{kind}</span> {text}
          </span>
          {clear && (
            <button
              aria-label={`Clear ${kind} filter`}
              className="grid h-5 w-5 flex-none place-items-center rounded-[5px] text-[var(--text-muted)] hover:bg-[var(--accent)]/20 hover:text-[var(--text-primary)]"
              type="button"
              onClick={() => onChange({ ...query, ...clear })}
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="10"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.4"
                viewBox="0 0 24 24"
                width="10"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
