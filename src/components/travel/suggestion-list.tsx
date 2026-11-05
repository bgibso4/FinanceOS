'use client';

import { formatAmountCompact } from '@/lib/currency';
import type { Suggestion, SuggestionGroup } from '@/lib/travel/types';

const GROUPS: { group: SuggestionGroup; heading: string }[] = [
  { group: 'before', heading: 'Booked before · Flights & Lodging, up to 4 months ahead' },
  { group: 'during', heading: 'During · Travel categories' },
  { group: 'other', heading: 'Other spending during the trip' },
  { group: 'after', heading: 'After · money back & late charges, 3 weeks' },
];

const money = (s: Suggestion) => {
  const { amount, account } = s.tx;
  return `${amount < 0 ? '−' : '+'}${formatAmountCompact(Math.abs(amount), account?.currency ?? 'USD')}`;
};

type SuggestionListProps = {
  suggestions: Suggestion[];
  ticked: ReadonlySet<string>;
  onToggle: (txId: string) => void;
};

export function SuggestionList({ suggestions, ticked, onToggle }: SuggestionListProps) {
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map(({ group, heading }) => {
        const rows = suggestions.filter((s) => s.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group}>
            <h4 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {heading}
            </h4>
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {rows.map((s) => (
                <li key={s.tx.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-card)]">
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
                        {`${String(s.tx.date).slice(0, 10)} · ${s.tx.category?.name ?? 'Uncategorized'} · ${s.reason}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-[var(--text-primary)]">
                      {money(s)}
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
