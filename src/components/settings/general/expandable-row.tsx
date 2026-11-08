import type { KeyboardEvent, ReactNode } from 'react';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/cn';

const LEADING = 'flex w-4 shrink-0 items-center justify-center';
const CHEVRON_SLOT = 'flex w-[18px] shrink-0 justify-end';

/**
 * Column captions over a run of ExpandableRows, padded to line up with their cells. `leading`
 * reserves the leading slot's width when the rows have one.
 */
export function ExpandableRowHeader({ leading, cells }: { leading?: boolean; cells: ReactNode }) {
  return (
    <div className="flex items-center gap-[18px] border-t border-[var(--border)] px-[18px] pb-0.5 pt-3 text-[11px] text-[var(--text-muted)] first:border-t-0 [&+div]:border-t-0">
      {leading && <span className={LEADING} />}
      <div className="min-w-0 flex-1">{cells}</div>
      <span className={CHEVRON_SLOT} />
    </div>
  );
}

/**
 * A row that opens a detail panel beneath it. The row is one button (click, Enter or Space);
 * `leading` (a 16px control such as a radio) sits beside it, so using it never toggles the row.
 */
export function ExpandableRow({
  leading,
  cells,
  open,
  onToggle,
  detail,
}: {
  leading?: ReactNode;
  cells: ReactNode;
  open: boolean;
  onToggle: () => void;
  detail: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onToggle();
  };

  return (
    <div className="border-t border-[var(--border)]">
      <div
        className={cn(
          'flex items-stretch',
          open
            ? 'bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]'
            : 'hover:bg-[color-mix(in_srgb,var(--text-primary)_2.5%,transparent)]'
        )}
      >
        {leading && <div className={cn(LEADING, 'ml-[18px]')}>{leading}</div>}
        <div
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[18px] py-3 pl-[18px] pr-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--border-hover)]"
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={onKeyDown}
        >
          <div className="min-w-0 flex-1">{cells}</div>
          <span className={CHEVRON_SLOT}>
            <i
              aria-hidden
              className={cn(
                'block h-[7px] w-[7px] border-b-[1.5px] border-r-[1.5px] border-[var(--text-muted)] transition-transform duration-150',
                open ? 'rotate-45' : '-rotate-45'
              )}
            />
          </span>
        </div>
      </div>
      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-card)] px-[18px] pb-3 pt-1.5">
          {detail}
        </div>
      )}
    </div>
  );
}

/** Hides a "Past year" column on narrow screens, where the row has no room for it. */
export const SPARK_COLUMN = 'hidden sm:block';

/**
 * A row's sparkline cell. Pointing at the sparkline reads it, so clicks here never toggle the row.
 */
export function SparkCell({ children }: { children: ReactNode }) {
  return (
    <div className={SPARK_COLUMN} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

export type DetailColumn = string | { label: string; tip: string };
const columnLabel = (c: DetailColumn) => (typeof c === 'string' ? c : c.label);

/**
 * The table an ExpandableRow opens: a text column, then right-aligned figures, then a note. A
 * column given as `{ label, tip }` explains itself on hover.
 */
export function DetailTable({
  columns,
  rows,
  note,
}: {
  columns: DetailColumn[];
  rows: { key: string; cells: ReactNode[] }[];
  note: ReactNode;
}) {
  return (
    <>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={columnLabel(c)}
                className={cn(
                  'pb-1.5 pt-2 text-[11px] font-normal text-[var(--text-muted)]',
                  i === 0 ? 'text-left' : 'text-right'
                )}
              >
                {typeof c === 'string' ? (
                  c
                ) : (
                  <InfoTip align={i === 0 ? 'start' : 'end'} text={c.tip}>
                    {c.label}
                  </InfoTip>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, i) => (
                <td
                  key={columnLabel(columns[i])}
                  className={cn(
                    'border-t border-[var(--border)] py-1.5 text-[var(--text-primary)]',
                    i > 0 && 'text-right font-mono tabular-nums'
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[11px] text-[var(--text-muted)]">{note}</div>
    </>
  );
}
