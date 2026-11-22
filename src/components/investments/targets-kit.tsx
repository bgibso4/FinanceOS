'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { useCollapsed } from './use-collapsed';

/** A security that can be bought, for the "buy with" pickers. */
export type BuyOption = { id: string; label: string };

/** Every field on the tab shares one height and look, so rows line up as a grid. */
const FIELD =
  'h-[30px] w-full rounded-[7px] border border-[var(--border)] bg-[var(--bg-base)] px-[9px] text-[13px] text-[var(--text-primary)] hover:border-[var(--border-hover)] focus-visible:border-[var(--accent)] focus-visible:outline-none';
export const TH =
  'pb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]';
export const MONO = 'font-mono text-[12.5px] tabular-nums';
export const HINT_TEXT = 'text-xs text-[var(--text-muted)]';

/** Segment colours for the targets, in the order the targets are listed. */
const SEGMENTS = ['#9a7a58', '#c2a684', '#6b5540', '#7d9079', '#7b8791', '#8c6f80', '#b3a06a'];
export const segmentColor = (index: number) =>
  index < 0 ? 'var(--text-muted)' : SEGMENTS[index % SEGMENTS.length];

/** Accepts "20", "+20", "20%"; anything else is not a number. */
export function parsePct(text: string): number | null {
  const t = text.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)%?$/.test(t) ? Number(t.replace('%', '')) : null;
}

export const fraction = (f: number) => `${(f * 100).toFixed(1)}%`;

const isHundred = (total: number) => Math.abs(total - 100) <= 0.005;

/** "Total 100%", or the total to 2 places and that it is scaled when it is not 100. */
export const totalNote = (total: number, label = 'Total') =>
  isHundred(total) ? `${label} 100%` : `${label} ${total.toFixed(2)}% · scaled to 100%`;

/** A percentage field that keeps what is typed, and only reports values that parse. */
export function PctInput({
  label,
  signed,
  value,
  onChange,
}: {
  label: string;
  signed?: boolean;
  value: number;
  onChange: (n: number) => void;
}) {
  const shown = (n: number) => (signed && n > 0 ? `+${n}` : String(n));
  const [text, setText] = useState(shown(value));
  useEffect(() => {
    setText((t) => (parsePct(t) === value ? t : shown(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="relative block">
      <input
        aria-label={label}
        className={cn(FIELD, MONO, 'pr-[22px] text-right')}
        inputMode="decimal"
        value={text}
        onBlur={() => setText(shown(value))}
        onChange={(e) => {
          setText(e.target.value);
          const n = parsePct(e.target.value);
          if (n !== null) onChange(n);
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11.5px] text-[var(--text-muted)]"
      >
        %
      </span>
    </span>
  );
}

export type Row<T> = T & { key: string };
let newRows = 0;
const withKeys = <T extends { id?: string }>(items: T[]): Row<T>[] =>
  items.map((i) => ({ ...i, key: i.id ?? `new-${++newRows}` }));
const withoutKeys = <T,>(rows: Row<T>[]): T[] =>
  rows.map(({ key: _key, ...r }) => r as unknown as T);

export type Draft<T> = ReturnType<typeof useDraft<T & { id?: string }>>;

/** A draft of a saved list: edits stay until saved or discarded. New rows get a `new-…` key. */
export function useDraft<T extends { id?: string }>(saved: T[]) {
  const source = useMemo(() => withKeys(saved), [saved]);
  const [edited, setEdited] = useState<Row<T>[] | null>(null);
  const rows = edited ?? source;
  const dirty = edited !== null && JSON.stringify(edited) !== JSON.stringify(source);
  return {
    rows,
    dirty,
    items: () => withoutKeys(rows),
    patch: (key: string, change: Partial<T>) =>
      setEdited(rows.map((r) => (r.key === key ? { ...r, ...change } : r))),
    /** Rewrite every row, e.g. to swap a new row's key for its saved id. */
    map: (fn: (row: Row<T>) => Row<T>) => setEdited((e) => (e ? e.map(fn) : e)),
    remove: (key: string) => setEdited(rows.filter((r) => r.key !== key)),
    add: (item: T) => setEdited([...rows, ...withKeys([item])]),
    reset: () => setEdited(null),
  };
}

export function Pill({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full px-[7px] py-px font-mono text-[11px]',
        tone === 'ok' && 'bg-[color-mix(in_srgb,var(--green)_13%,transparent)] text-[var(--green)]',
        tone === 'warn' &&
          'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]',
        !tone && 'bg-[var(--border)] text-[var(--text-secondary)]'
      )}
    >
      {children}
    </span>
  );
}

/** A pill for a total that should be 100; `quiet` skips the amber when it is routinely off. */
export function TotalPill({
  label,
  quiet,
  total,
}: {
  label?: string;
  quiet?: boolean;
  total: number;
}) {
  const tone = isHundred(total) ? 'ok' : quiet ? undefined : 'warn';
  return <Pill tone={tone}>{totalNote(total, label)}</Pill>;
}

const COLLAPSED_KEY = 'financeos:targets-collapsed';

/** A card; with a `collapseKey` its title folds it down to the header, pill included. */
export function CardShell({
  children,
  collapseKey,
  pill,
  subtitle,
  title,
}: {
  children: ReactNode;
  collapseKey?: string;
  pill?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  const [collapsed, toggle] = useCollapsed(COLLAPSED_KEY, collapseKey);
  return (
    <Card aria-label={title} className="min-w-0 px-5 py-[18px]" role="region">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {collapseKey ? (
            <button
              aria-expanded={!collapsed}
              className="-my-1 flex items-center gap-2 rounded-[5px] py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              type="button"
              onClick={toggle}
            >
              <span
                aria-hidden
                className={cn(
                  'text-[9px] text-[var(--text-muted)] transition-transform',
                  !collapsed && 'rotate-90'
                )}
              >
                ▶
              </span>
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        {pill}
      </div>
      {!collapsed && (
        <>
          {subtitle && <p className={`${HINT_TEXT} mb-3 mt-0.5`}>{subtitle}</p>}
          {children}
        </>
      )}
    </Card>
  );
}

export function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: color }} />;
}

export function NameInput({
  className,
  label,
  onChange,
  value,
}: {
  className?: string;
  label: string;
  onChange: (name: string) => void;
  value: string;
}) {
  return (
    <input
      aria-label={label}
      className={cn(FIELD, 'min-w-0', className ?? 'font-medium')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid size-7 place-items-center rounded-[7px] text-[var(--text-muted)] opacity-60 hover:bg-[var(--border)] hover:text-[var(--red)] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      type="button"
      onClick={onClick}
    >
      <svg
        aria-hidden
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
        viewBox="0 0 12 12"
      >
        <path d="M2 2l8 8M10 2l-8 8" />
      </svg>
    </button>
  );
}

/** The dashed "add a row" control at the end of a list. */
export function AddRow({
  label,
  onClick,
  small,
}: {
  label: string;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      className={cn(
        'block w-full rounded-[7px] border border-dashed border-[var(--border-hover)] px-2.5 text-left text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
        small ? 'mt-[3px] h-7 text-xs' : 'mt-1.5 h-[30px] text-[12.5px]'
      )}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** A select in the tab's field style; `muted` greys the text for an empty choice. */
export function FieldSelect({
  className,
  muted,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { muted?: boolean }) {
  return (
    <select
      className={cn(FIELD, 'min-w-0 text-[12.5px]', muted && 'text-[var(--text-muted)]', className)}
      {...props}
    />
  );
}

export function BuyWithSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (id: string | null) => void;
  options: BuyOption[];
  value: string | null;
}) {
  return (
    <FieldSelect
      aria-label={label}
      muted={!value}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">None</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </FieldSelect>
  );
}
