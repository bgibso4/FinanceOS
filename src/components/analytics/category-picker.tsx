'use client';

import { useState } from 'react';
import type { Category } from '@/components/transactions/types';
import { Input } from '@/components/ui/input';
import { childrenByParent } from '@/lib/analytics-series';
import { fmtMoney } from '@/lib/currency';
import { UNCATEGORIZED } from '@/lib/transaction-filters';
import { TickRow, type Ticked } from './tick-row';

type CategoryPickerProps = {
  categories: Category[];
  selected: string[];
  onChange(selected: string[]): void;
  /** Spend for the period by group id (a top-level category is its own group), plus UNCATEGORIZED. */
  groupTotals: Record<string, number>;
};

type Group = { cat: Category; children: Category[] };

function groupsOf(categories: Category[]): Group[] {
  const children = childrenByParent(categories);
  return categories
    .filter((c) => !c.parentId)
    .map((cat) => ({ cat, children: children.get(cat.id) ?? [] }));
}

/**
 * A group's own id is in the selection exactly when every one of its categories is, so a
 * fully ticked group also covers rows booked on the group itself.
 */
function withGroupIds(ids: Set<string>, groups: Group[]): string[] {
  for (const { cat, children } of groups) {
    if (!children.length) continue;
    if (children.every((c) => ids.has(c.id))) ids.add(cat.id);
    else ids.delete(cat.id);
  }
  return [...ids];
}

const matches = (name: string, q: string) => name.toLowerCase().includes(q);

/** Groups with tick boxes (all / some / none) and their categories indented below. */
export function CategoryPicker({
  categories,
  selected,
  onChange,
  groupTotals,
}: CategoryPickerProps) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const groups = groupsOf(categories);
  const ticked = new Set(selected);
  const total = (id: string) => fmtMoney(groupTotals[id] ?? 0);

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(ticked);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onChange(withGroupIds(next, groups));
  };

  return (
    <div>
      <Input
        aria-label="Search categories"
        className="h-8 rounded-lg text-[13px]"
        placeholder="Search categories…"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="mt-1.5">
        {groups.map(({ cat, children }) => {
          if (!children.length) {
            if (!matches(cat.name, q)) return null;
            return (
              <TickRow
                key={cat.id}
                aside={total(cat.id)}
                checked={ticked.has(cat.id)}
                label={cat.name}
                onToggle={() => toggle([cat.id], !ticked.has(cat.id))}
              />
            );
          }
          const shown = matches(cat.name, q)
            ? children
            : children.filter((c) => matches(c.name, q));
          if (!shown.length) return null;
          const count = children.filter((c) => ticked.has(c.id)).length;
          const state: Ticked = count === children.length ? true : count ? 'mixed' : false;
          return (
            <div key={cat.id}>
              <TickRow
                aside={total(cat.id)}
                checked={state}
                label={cat.name}
                onToggle={() => toggle([cat.id, ...children.map((c) => c.id)], state !== true)}
              />
              {shown.map((c) => (
                <TickRow
                  key={c.id}
                  indent
                  checked={ticked.has(c.id)}
                  label={c.name}
                  onToggle={() => toggle([c.id], !ticked.has(c.id))}
                />
              ))}
            </div>
          );
        })}
        {matches('Uncategorized', q) && (
          <TickRow
            aside={total(UNCATEGORIZED)}
            checked={ticked.has(UNCATEGORIZED)}
            label="Uncategorized"
            onToggle={() => toggle([UNCATEGORIZED], !ticked.has(UNCATEGORIZED))}
          />
        )}
      </div>
    </div>
  );
}
