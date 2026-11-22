'use client';

import type { ReactNode } from 'react';
import { useCollapsed } from './use-collapsed';

const SECTIONS_KEY = 'financeos:investments-sections-collapsed';

/** A full-width section whose header folds it down to a one-line `summary`, remembered. */
export function DetailSection({
  id,
  title,
  count,
  hint,
  summary,
  extra,
  children,
}: {
  id: string;
  title: string;
  count: ReactNode;
  hint: string;
  summary: string | null;
  /** Controls beside the title, outside the fold button (e.g. "Clear filters"). */
  extra?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(SECTIONS_KEY, id);
  return (
    <section aria-label={title} className="mt-8">
      <div className="flex items-center gap-3 border-b border-[var(--border-hover)] pb-2.5">
        <button
          aria-expanded={!collapsed}
          className="group flex min-w-0 items-center gap-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          type="button"
          onClick={toggle}
        >
          <span
            aria-hidden
            className={`text-[9px] text-[var(--text-muted)] transition-transform ${
              collapsed ? '' : 'rotate-90'
            }`}
          >
            ▶
          </span>
          <span className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
            {title}
          </span>
          <span className="rounded-full bg-[var(--bg-elevated)] px-2 font-mono text-[11px] text-[var(--text-muted)]">
            {count}
          </span>
          {collapsed && summary && (
            <span className="ml-1 truncate font-mono text-xs text-[var(--text-secondary)]">
              {summary}
            </span>
          )}
        </button>
        {extra}
        <span className="ml-auto shrink-0 text-[10.5px] font-medium uppercase tracking-[0.6px] text-[var(--text-muted)]">
          {hint}
        </span>
      </div>
      {!collapsed && children}
    </section>
  );
}
