'use client';

import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { triggerSync } from '@/lib/cloud-sync';
import { Pricing } from '@/lib/investments/codes';
import type { SecurityList, SecurityListItem } from '@/lib/investments/security-list';
import { PriceWindow } from './price-window';
import {
  SECURITY_FILTERS,
  filterSecurities,
  heldInText,
  latestView,
  nameLine,
  priceSourceView,
  typeLabel,
  type SecurityFilter,
} from './securities-view';

const GRID =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] items-center gap-3.5 md:grid-cols-[minmax(0,1.6fr)_90px_90px_minmax(0,1.5fr)_110px_36px]';
const WIDE = 'hidden md:block';
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
const ICON_BUTTON = `inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-transparent text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] ${FOCUS_RING}`;
const HIGHLIGHT =
  'rounded-lg bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-inset ring-[var(--accent)]';
const MESSAGE = 'py-6 text-center text-sm text-[var(--text-secondary)]';

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
      width="14"
    >
      <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7 2.5 13.5l.8-2.9z" />
      <path d="M10 3.5l2.5 2.5" />
    </svg>
  );
}

function SecurityRow({
  security: s,
  highlighted,
  rowRef,
  onEdit,
}: {
  security: SecurityListItem;
  highlighted: boolean;
  rowRef?: Ref<HTMLLIElement>;
  onEdit: () => void;
}) {
  const source = priceSourceView(s);
  const latest = latestView(s);
  const name = nameLine(s);
  const action = `Change how ${s.label} is priced`;
  return (
    <li
      ref={rowRef}
      aria-current={highlighted ? 'true' : undefined}
      aria-label={s.label}
      className={`${GRID} border-b border-[var(--border)] px-2 py-2.5 last:border-b-0 ${
        highlighted ? HIGHLIGHT : ''
      }`}
    >
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] text-[var(--text-primary)]">{s.label}</div>
        {name && <div className="truncate text-[11.5px] text-[var(--text-muted)]">{name}</div>}
      </div>
      <span className={`${WIDE} text-xs text-[var(--text-secondary)]`}>{typeLabel(s.type)}</span>
      <span className={`${WIDE} text-xs text-[var(--text-secondary)]`}>{heldInText(s.heldIn)}</span>
      <div className="min-w-0 text-xs">
        <div
          className={`font-medium ${source.warn ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}
        >
          {source.main}
        </div>
        {source.detail && (
          <div className="text-[11px] text-[var(--text-muted)]">{source.detail}</div>
        )}
      </div>
      <div className={`${WIDE} text-right font-mono text-xs text-[var(--text-primary)]`}>
        <div>{latest ? latest.price : '—'}</div>
        {latest?.date && (
          <div className="text-[10.5px] text-[var(--text-muted)]">{latest.date}</div>
        )}
      </div>
      <div className="text-right">
        {s.pricing !== Pricing.Fixed && (
          <button
            aria-label={action}
            className={ICON_BUTTON}
            title={action}
            type="button"
            onClick={onEdit}
          >
            <PencilIcon />
          </button>
        )}
      </div>
    </li>
  );
}

/** Settings → Securities: how every security is priced, and the price window to change it. */
export function SecuritiesTab({ focusId }: { focusId: string | null }) {
  const [list, setList] = useState<SecurityList | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<SecurityFilter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<SecurityListItem | null>(null);
  const [highlighted, setHighlighted] = useState(focusId);
  const focusRow = useRef<HTMLLIElement>(null);

  const latestLoad = useRef(0);

  // Only the newest load may set state; unmounting supersedes any load still in flight.
  const load = useCallback(async () => {
    const id = ++latestLoad.current;
    try {
      const res = await fetch('/api/investments/securities');
      if (!res.ok) throw new Error('securities failed');
      const next: SecurityList = await res.json();
      if (id !== latestLoad.current) return;
      setList(next);
      setFailed(false);
    } catch {
      if (id === latestLoad.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      latestLoad.current++;
    };
  }, [load]);

  // A deep-linked row is brought into view once the list arrives.
  useEffect(() => {
    if (list) focusRow.current?.scrollIntoView?.({ block: 'center' });
  }, [list]);

  // The highlight lasts until the next click anywhere.
  useEffect(() => {
    if (!highlighted) return;
    const clear = () => setHighlighted(null);
    document.addEventListener('click', clear);
    return () => document.removeEventListener('click', clear);
  }, [highlighted]);

  const saved = async () => {
    setEditing(null);
    triggerSync();
    await load();
  };

  if (!list) {
    return (
      <Card className="p-6 text-sm text-[var(--text-secondary)]">
        {failed ? (
          <>
            Couldn’t load securities.{' '}
            <button
              className={`font-medium text-[var(--accent)] ${FOCUS_RING}`}
              type="button"
              onClick={() => void load()}
            >
              Try again
            </button>
          </>
        ) : (
          'Loading securities…'
        )}
      </Card>
    );
  }

  const all = list.securities;
  const rows = filterSecurities(all, filter, query);
  return (
    <div className="space-y-4">
      {failed && (
        <p
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]"
          role="alert"
        >
          Couldn’t refresh securities.{' '}
          <button
            className={`font-medium text-[var(--accent)] ${FOCUS_RING}`}
            type="button"
            onClick={() => void load()}
          >
            Try again
          </button>
        </p>
      )}
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
            {SECURITY_FILTERS.map((f) => (
              <button
                key={f.id}
                aria-pressed={f.id === filter}
                className={`rounded-md px-2.5 py-[3px] text-[11.5px] font-medium ${FOCUS_RING} ${
                  f.id === filter
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'
                }`}
                type="button"
                onClick={() => setFilter(f.id)}
              >
                {`${f.label} · ${all.filter(f.keeps).length}`}
              </button>
            ))}
          </div>
          <Input
            aria-label="Search securities"
            className="h-9 max-w-[260px]"
            placeholder="Search ticker or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <Card className="px-5 py-3.5">
        {all.length === 0 ? (
          <p className={MESSAGE}>
            No securities yet. They appear once an investment account has holdings or trades.
          </p>
        ) : (
          <>
            <div
              className={`${GRID} border-b border-[var(--border)] px-2 pb-2 text-[10.5px] font-medium uppercase tracking-[0.6px] text-[var(--text-muted)]`}
            >
              <span>Security</span>
              <span className={WIDE}>Type</span>
              <span className={WIDE}>Held in</span>
              <span>Price source</span>
              <span className={`${WIDE} text-right`}>Latest price</span>
              <span />
            </div>
            {rows.length === 0 ? (
              <p className={MESSAGE}>No securities match.</p>
            ) : (
              <ul aria-label="Securities">
                {rows.map((s) => (
                  <SecurityRow
                    key={s.id}
                    highlighted={s.id === highlighted}
                    rowRef={s.id === highlighted ? focusRow : undefined}
                    security={s}
                    onEdit={() => setEditing(s)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
      {editing && (
        <PriceWindow
          key={editing.id}
          hint={list.symbolHint}
          security={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
