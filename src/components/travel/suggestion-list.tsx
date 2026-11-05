'use client';

import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { formatAmountCompact } from '@/lib/currency';
import { isoDay } from '@/lib/investments/dates';
import type { Suggestion, SuggestionGroup } from '@/lib/travel/types';
import { shortDate } from './format';

const GROUPS: { group: SuggestionGroup; heading: string }[] = [
  { group: 'before', heading: 'Booked before · Flights & Lodging, up to 4 months ahead' },
  { group: 'during', heading: 'During · Travel categories' },
  { group: 'other', heading: 'Other spending during the trip' },
  { group: 'after', heading: 'After · money back & late charges, 3 weeks' },
];

const money = (s: Suggestion, baseCurrency: string) => {
  const { amount, account } = s.tx;
  return `${amount < 0 ? '−' : '+'}${formatAmountCompact(Math.abs(amount), account?.currency ?? baseCurrency, baseCurrency)}`;
};

type SuggestionListProps = {
  baseCurrency: string;
  suggestions: Suggestion[];
  ticked: ReadonlySet<string>;
  onToggle: (txId: string) => void;
};

export function SuggestionList({
  baseCurrency,
  suggestions,
  ticked,
  onToggle,
}: SuggestionListProps) {
  return (
    <div>
      {GROUPS.map(({ group, heading }) => {
        const rows = suggestions.filter((s) => s.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className={SECTION_CARD}>
            <h3
              className={`${SECTION_HEAD} !text-[11.5px] uppercase tracking-wide !text-[var(--text-muted)]`}
            >
              {heading}
            </h3>
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((s) => (
                <li key={s.tx.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5 hover:bg-[var(--bg-elevated)]">
                    <input
                      checked={ticked.has(s.tx.id)}
                      className="h-4 w-4 accent-[var(--accent)]"
                      type="checkbox"
                      onChange={() => onToggle(s.tx.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--text-primary)]">
                        {s.tx.merchant}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--text-muted)]">
                        {`${shortDate(isoDay(new Date(s.tx.date)))} · ${s.tx.category?.name ?? 'Uncategorized'} · ${s.reason}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-[var(--text-primary)]">
                      {money(s, baseCurrency)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
