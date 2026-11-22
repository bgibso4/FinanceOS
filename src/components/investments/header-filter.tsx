'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type FilterOption = { value: string; label: string; count: number };

/**
 * A column header that opens a checklist. Ticked values filter the column; none ticked shows
 * everything. The header turns accent with a count while a filter is on.
 */
export function HeaderFilter({
  label,
  options,
  selected,
  onChange,
  searchable,
  optionClass,
}: {
  label: string;
  options: FilterOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
  /** Styles an option's label, e.g. the same colour the column uses. */
  optionClass?: (value: string) => string;
}) {
  // Where the open menu sits on screen. It is portalled to <body> and fixed-positioned, so neither
  // the table's sideways scroll box nor an animated (transformed) ancestor can clip or shift it.
  // It closes on scroll rather than drifting away from its header.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setAt(null);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null);
    document.addEventListener('mousedown', outside);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const openMenu = () => {
    const r = ref.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 4, left: Math.max(8, r.left - 8) });
  };

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (!next.delete(value)) next.add(value);
    onChange(next);
  };
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <span ref={ref} className="inline-block">
      <button
        aria-expanded={open}
        aria-label={`Filter ${label}`}
        className={`-mx-1 inline-flex items-center gap-1.5 rounded-[5px] px-1 uppercase hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] ${
          selected.size ? 'text-[var(--accent)]' : ''
        }`}
        type="button"
        onClick={() => (open ? setAt(null) : openMenu())}
      >
        {label}
        {selected.size > 0 && (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 font-mono text-[10px] normal-case tracking-normal">
            {selected.size}
          </span>
        )}
        <svg aria-hidden className="size-2 opacity-70" fill="currentColor" viewBox="0 0 8 8">
          <path d="M0 2h8L4 7z" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-30 max-h-[280px] min-w-[210px] overflow-auto rounded-[10px] border border-[var(--border-hover)] bg-[var(--bg-card)] p-1.5 text-xs normal-case tracking-normal text-[var(--text-primary)] shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
            style={at}
          >
            {searchable && (
              <input
                aria-label={`Find a ${label.toLowerCase()}`}
                className="mb-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
                placeholder={`Find a ${label.toLowerCase()}`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            {shown.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-[var(--bg-elevated)]"
              >
                <input
                  checked={selected.has(o.value)}
                  className="accent-[var(--accent)]"
                  type="checkbox"
                  onChange={() => toggle(o.value)}
                />
                <span className={optionClass?.(o.value)}>{o.label}</span>
                <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">
                  {o.count}
                </span>
              </label>
            ))}
            <div className="mt-1 flex justify-between border-t border-[var(--border)] px-2 pb-0.5 pt-1.5 text-[11.5px]">
              <button
                className={`font-medium ${selected.size ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
                type="button"
                onClick={() => onChange(new Set())}
              >
                Clear
              </button>
              <span className="text-[var(--text-muted)]">
                {selected.size ? `${selected.size} selected` : 'Showing all'}
              </span>
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
