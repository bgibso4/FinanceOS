'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ERROR } from './editor-kit';

/** A security that can be bought, for the "buy with" pickers. */
export type BuyOption = { id: string; label: string };

export const TH =
  'px-2 pb-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]';
export const TD = 'px-2 py-1.5 align-middle';
export const MONO_CELL = `${TD} text-right font-mono text-[13px] text-[var(--text-secondary)]`;
const LINK_BUTTON =
  'text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

/** Accepts "20", "+20", "20%"; anything else is not a number. */
export function parsePct(text: string): number | null {
  const t = text.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)%?$/.test(t) ? Number(t.replace('%', '')) : null;
}

export const fraction = (f: number) => `${(f * 100).toFixed(1)}%`;

/** "Total 100%", or the total to 2 places and that it is scaled when it is not 100. */
export const totalNote = (total: number) =>
  Math.abs(total - 100) > 0.005 ? `Total ${total.toFixed(2)}% · scaled to 100%` : 'Total 100%';

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
    <Input
      aria-label={label}
      className="h-9 w-[84px] text-right"
      inputMode="decimal"
      value={text}
      onBlur={() => setText(shown(value))}
      onChange={(e) => {
        setText(e.target.value);
        const n = parsePct(e.target.value);
        if (n !== null) onChange(n);
      }}
    />
  );
}

export type Row<T> = T & { key: string };
let newRows = 0;
const withKeys = <T extends { id?: string }>(items: T[]): Row<T>[] =>
  items.map((i) => ({ ...i, key: i.id ?? `new-${++newRows}` }));
const withoutKeys = <T,>(rows: Row<T>[]): T[] =>
  rows.map(({ key: _key, ...r }) => r as unknown as T);

export type Draft<T> = ReturnType<typeof useDraft<T & { id?: string }>>;

/** The card's own draft of a list: edits stay until saved, other cards' saves don't discard them. */
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
    remove: (key: string) => setEdited(rows.filter((r) => r.key !== key)),
    add: (item: T) => setEdited([...rows, ...withKeys([item])]),
    reset: () => setEdited(null),
  };
}

export function CardShell({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <Card aria-label={title} className="p-6" role="region">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 max-w-[62ch] text-[12.5px] text-[var(--text-secondary)]">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}

export type Column = { label: string; right?: boolean };

/** A header row; an empty label is the remove column. */
export function TableHead({ columns }: { columns: Column[] }) {
  return (
    <thead>
      <tr>
        {columns.map((c, i) => (
          <th key={i} className={`${TH} ${c.right ? 'text-right' : ''}`}>
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * A card that edits a list: table of draft rows, add link, a note, the error and that card's
 * Save. Saving resets the draft on success.
 */
export function EditableList<T extends { id?: string }>({
  addLabel,
  columns,
  draft,
  error,
  newItem,
  note,
  onSave,
  renderRow,
  saving,
  subtitle,
  title,
}: {
  addLabel: string;
  columns: Column[];
  draft: ReturnType<typeof useDraft<T>>;
  error: string | null;
  newItem: T;
  note: ReactNode;
  onSave: (items: T[]) => Promise<boolean>;
  renderRow: (row: Row<T>) => ReactNode;
  saving: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <CardShell subtitle={subtitle} title={title}>
      <table className="w-full">
        <TableHead columns={columns} />
        <tbody>
          {draft.rows.map((r) => (
            <tr key={r.key}>{renderRow(r)}</tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button className={LINK_BUTTON} type="button" onClick={() => draft.add(newItem)}>
            {addLabel}
          </button>
          <span className="font-mono text-xs text-[var(--text-muted)]">{note}</span>
        </div>
        <Button
          disabled={!draft.dirty || saving}
          type="button"
          onClick={async () => {
            if (await onSave(draft.items())) draft.reset();
          }}
        >
          Save
        </Button>
      </div>
      {error && <p className={ERROR}>{error}</p>}
    </CardShell>
  );
}

export function NameCell({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (name: string) => void;
  value: string;
}) {
  return (
    <td className={TD}>
      <Input
        aria-label={label}
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </td>
  );
}

export function PctCell(props: React.ComponentProps<typeof PctInput>) {
  return (
    <td className={`${TD} text-right`}>
      <PctInput {...props} />
    </td>
  );
}

/** The remove column; `blockedReason` disables it and says why. */
export function RemoveCell({
  blockedReason,
  label,
  onClick,
}: {
  blockedReason?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <td className={`${TD} text-right`}>
      <Button
        aria-label={label}
        className="h-8 px-2"
        disabled={!!blockedReason}
        title={blockedReason}
        type="button"
        variant="ghost"
        onClick={onClick}
      >
        ✕
      </Button>
    </td>
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
    <Select
      aria-label={label}
      className="h-9"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">None</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
