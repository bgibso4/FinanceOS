'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Category } from '@/components/transactions/types';
import { Input } from '@/components/ui/input';
import {
  COMPARE_LABELS,
  KIND_LABELS,
  periodLabel,
  switchKind,
  type CompareKind,
  type PeriodKind,
} from '@/lib/analytics-period';
import { activeFilterCount, capped, type AnalyticsQuery } from '@/lib/analytics-query';
import { picksFor } from '@/lib/analytics-series';
import { byName } from '@/lib/sort-by-name';
import { CategoryPicker } from './category-picker';
import { TickRow } from './tick-row';

/** P6: the merchant box applies this long after typing stops, so keystrokes don't refetch. */
const MERCHANT_DELAY_MS = 300;
/** Tags fold away only when there are more than this many. */
const MAX_OPEN_TAGS = 8;

type FilterPanelProps = {
  open: boolean;
  query: AnalyticsQuery;
  onChange(q: AnalyticsQuery): void;
  onClose(): void;
  categories: Category[];
  accounts: { id: string; name: string }[];
  tags: string[];
  /** Spend for the period by group id, plus UNCATEGORIZED. */
  groupTotals: Record<string, number>;
  today: string;
  /** The button that opens the panel: pressing it isn't an "outside" click. */
  toggleRef: RefObject<HTMLElement | null>;
};

const toggled = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/**
 * The floating filter card (spec section 4). Picks apply at once through `onChange` and never
 * close it; Done, ✕, Esc and a press outside the card (and its toggle) call `onClose`.
 */
export function FilterPanel({
  open,
  query,
  onChange,
  onClose,
  categories,
  accounts,
  tags,
  groupTotals,
  today,
  toggleRef,
}: FilterPanelProps) {
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The merchant box applies later; it must build on the query as it is then.
  const latest = useRef({ query, onChange });
  latest.current = { query, onChange };
  const [merchantBox, setMerchantBox] = useState(0);
  // Keys the collapsible sections so each starts closed every time the panel opens.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (open) setOpened((n) => n + 1);
  }, [open]);
  const openerRef = useRef<HTMLElement | null>(null);
  /**
   * Esc, Done and ✕ hand focus back to what opened the panel. A press outside doesn't: the
   * press is moving focus itself, and focusing the opener would scroll the page under it.
   */
  const dismiss = useCallback(() => {
    onCloseRef.current();
    if (openerRef.current?.isConnected) openerRef.current.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    openerRef.current = document.activeElement as HTMLElement | null;
    card?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      dismiss();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (card?.contains(target) || toggleRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, toggleRef, dismiss]);

  const set = (patch: Partial<AnalyticsQuery>) => onChange({ ...query, ...patch });
  const { period } = query;
  const setCustom = (start: string, end: string) => {
    if (!start || !end || start > end || end > today) return;
    set({ period: { kind: 'custom', anchor: end.slice(0, 7), custom: { start, end } } });
  };
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const pickNames = picksFor(query.categories, categories).map((p) => p.label);

  return (
    <section
      ref={cardRef}
      aria-hidden={open ? undefined : true}
      aria-label="Filters"
      aria-modal="false"
      className={`fixed bottom-3.5 right-3.5 top-3.5 z-[35] flex w-[min(340px,calc(100vw-28px))] origin-top-right flex-col rounded-[20px] border border-[var(--border-hover)] bg-[var(--bg-card)] shadow-[0_24px_60px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.06)] outline-none transition-[transform,opacity] [transition-duration:380ms] [transition-timing-function:cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${
        open ? 'opacity-100' : 'pointer-events-none translate-x-[30px] scale-[.96] opacity-0'
      }`}
      inert={!open}
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex items-center justify-between px-5 pb-3 pt-[18px]">
        <h2 className="font-serif text-[20px] text-[var(--text-primary)]">Filters</h2>
        <button
          aria-label="Close filters"
          className="grid h-8 w-8 place-items-center rounded-[9px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          title="Close · Esc"
          type="button"
          onClick={dismiss}
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        <Section summary={periodLabel(period)} title="Period">
          <Pills
            current={period.kind}
            labels={KIND_LABELS}
            onPick={(kind: PeriodKind) => set({ period: switchKind(period, kind, today) })}
          />
          {period.kind === 'custom' && period.custom && (
            <div className="mt-2 flex gap-1.5">
              <DateField
                label="From"
                max={period.custom.end}
                value={period.custom.start}
                onChange={(start) => setCustom(start, period.custom!.end)}
              />
              <DateField
                label="To"
                max={today}
                min={period.custom.start}
                value={period.custom.end}
                onChange={(end) => setCustom(period.custom!.start, end)}
              />
            </div>
          )}
        </Section>

        <Section title="Compared with">
          <Pills
            current={query.vs}
            labels={COMPARE_LABELS}
            onPick={(vs: CompareKind) => set({ vs })}
          />
        </Section>

        <Section
          key={`categories-${opened}`}
          collapsible
          emptySummary={`Any · ${categories.length}`}
          summary={pickNames.length ? capped(pickNames) : undefined}
          title="Categories"
        >
          <CategoryPicker
            categories={categories}
            groupTotals={groupTotals}
            selected={query.categories}
            onChange={(ids) => set({ categories: ids })}
          />
        </Section>

        <Section
          key={`accounts-${opened}`}
          collapsible
          emptySummary={`Any · ${accounts.length}`}
          summary={
            query.accounts.length
              ? capped(query.accounts.map((id) => accountName.get(id) ?? id))
              : undefined
          }
          title="Accounts"
        >
          {[...accounts].sort(byName).map((a) => (
            <TickRow
              key={a.id}
              checked={query.accounts.includes(a.id)}
              label={a.name}
              onToggle={() => set({ accounts: toggled(query.accounts, a.id) })}
            />
          ))}
        </Section>

        <Section
          key={`tags-${opened}`}
          collapsible={tags.length > MAX_OPEN_TAGS}
          emptySummary={`Any · ${tags.length}`}
          summary={query.tags.length ? capped(query.tags) : undefined}
          title="Tags"
        >
          {tags.map((t) => (
            <TickRow
              key={t}
              checked={query.tags.includes(t)}
              label={t}
              onToggle={() => set({ tags: toggled(query.tags, t) })}
            />
          ))}
        </Section>

        <Section summary={query.merchant ? `“${query.merchant}”` : undefined} title="Merchant">
          <MerchantInput
            key={merchantBox}
            value={query.merchant}
            onApply={(merchant) => latest.current.onChange({ ...latest.current.query, merchant })}
          />
        </Section>
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--border)] px-5 py-3.5">
        <button
          className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50 disabled:hover:text-[var(--text-muted)]"
          disabled={activeFilterCount(query) === 0}
          type="button"
          onClick={() => {
            set({ categories: [], accounts: [], tags: [], merchant: '' });
            // A fresh box drops typing not yet applied, even when the merchant was already empty.
            setMerchantBox((n) => n + 1);
          }}
        >
          Clear all
        </button>
        <button
          className="ml-auto rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          type="button"
          onClick={dismiss}
        >
          Done
        </button>
      </div>
    </section>
  );
}

function Section({
  title,
  summary,
  emptySummary,
  collapsible,
  children,
}: {
  title: string;
  summary?: string;
  /** Muted text for the collapsed header when nothing is picked. */
  emptySummary?: string;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expanded = !collapsible || open;
  const shown = summary ?? (collapsible ? emptySummary : undefined);
  const headerClass = 'flex w-full items-center justify-between gap-3 text-left';
  const heading = (
    <>
      <span className="uppercase tracking-[0.08em]">{title}</span>
      <span className="flex min-w-0 items-center gap-2">
        {shown && (
          <span
            className={`min-w-0 truncate font-medium normal-case tracking-normal ${
              summary ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {shown}
          </span>
        )}
        {collapsible && (
          <span
            aria-hidden="true"
            className={`text-[14px] leading-none transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ›
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className="border-t border-[var(--border)] py-4 first:border-t-0 first:pt-1">
      <h3
        className={`${expanded ? 'mb-3' : ''} text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted`}
      >
        {collapsible ? (
          <button
            aria-expanded={open}
            className={headerClass}
            type="button"
            onClick={() => setOpen((o) => !o)}
          >
            {heading}
          </button>
        ) : (
          <div className={headerClass}>{heading}</div>
        )}
      </h3>
      {expanded && children}
    </div>
  );
}

function Pills<K extends string>({
  labels,
  current,
  onPick,
}: {
  labels: Record<K, string>;
  current: K;
  onPick(k: K): void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(labels) as K[]).map((k) => {
        const on = k === current;
        return (
          <button
            key={k}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              on
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border-hover)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            type="button"
            onClick={() => onPick(k)}
          >
            {labels[k]}
          </button>
        );
      })}
    </div>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max: string;
  onChange(day: string): void;
}) {
  return (
    <Input
      aria-label={label}
      className="h-8 min-w-0 flex-1 px-2 text-[12px]"
      max={max}
      min={min}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * "Name contains", trimmed and applied once typing stops (P6). A text box, not a search box:
 * Esc in a search box clears it in Chrome and Safari, which would drop the filter as the panel closes.
 */
function MerchantInput({ value, onApply }: { value: string; onApply(v: string): void }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The last value sent, so its echo back through `value` isn't taken for an outside change.
  const sent = useRef(value);

  useEffect(() => {
    if (value === sent.current) return;
    // Cleared from outside (Clear all, a chip's ✕): show it and drop any pending apply.
    sent.current = value;
    clearTimeout(timer.current);
    setText(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Input
      aria-label="Merchant name contains"
      className="h-8 rounded-lg text-[13px]"
      placeholder="Name contains…"
      type="text"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const merchant = v.trim();
          if (merchant === sent.current) return;
          sent.current = merchant;
          onApply(merchant);
        }, MERCHANT_DELAY_MS);
      }}
    />
  );
}
