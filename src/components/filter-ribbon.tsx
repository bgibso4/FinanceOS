'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DateRangePreset } from '@/lib/types';

type Option = { id: string; name: string };

const presets: { id: DateRangePreset; label: string }[] = [
  { id: 'this-month', label: 'This Month' },
  { id: 'last-month', label: 'Last Month' },
  { id: 'last-3-months', label: 'Last 3 Months' },
  { id: 'ytd', label: 'Year to Date' },
  { id: 'last-12-months', label: 'Last 12 Months' },
  { id: 'custom', label: 'Custom Range' },
];

export function FilterRibbon() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [accounts, setAccounts] = useState<Option[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts?.filter((a: any) => a.isActive !== false) ?? []))
      .catch(() => {});
    fetch('/api/tags')
      .then((r) => r.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => {});
  }, []);

  const preset = (params.get('preset') as DateRangePreset) ?? 'last-3-months';
  const selectedAccount = params.get('account') ?? '';
  const selectedTag = params.get('tag') ?? '';
  const startDate = params.get('startDate') ?? '';
  const endDate = params.get('endDate') ?? '';

  const updateParams = (entries: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(entries).forEach(([key, value]) => {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    });
    router.push(`${pathname}?${next.toString()}`);
  };

  const activeFiltersCount = [selectedAccount, selectedTag].filter(Boolean).length;
  const currentPreset = presets.find((p) => p.id === preset);

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg mb-6">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          {/* Time Period Pills */}
          <div className="flex items-center gap-0.5 overflow-x-auto pb-0.5">
            {presets.map((p) => (
              <button
                key={p.id}
                className={`px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                  preset === p.id
                    ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                }`}
                onClick={() => {
                  if (p.id === 'custom') {
                    updateParams({ preset: p.id });
                  } else {
                    // Clear custom dates when switching to preset
                    updateParams({ preset: p.id, startDate: null, endDate: null });
                  }
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Filter Toggle + Account Quick Select */}
          <div className="flex items-center gap-1.5">
            {/* Account Quick Filter */}
            <select
              className="text-xs border border-[var(--border)] rounded-md px-2 py-1 h-7 bg-[var(--bg-card)] text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              value={selectedAccount}
              onChange={(e) => updateParams({ account: e.target.value || null })}
            >
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            {/* Tag Quick Filter */}
            {tags.length > 0 && (
              <select
                className="text-xs border border-[var(--border)] rounded-md px-2 py-1 h-7 bg-[var(--bg-card)] text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                value={selectedTag}
                onChange={(e) => updateParams({ tag: e.target.value || null })}
              >
                <option value="">All Tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}

            {/* Clear Filters */}
            {(selectedAccount || selectedTag || preset !== 'last-3-months') && (
              <button
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1.5 py-0.5"
                onClick={() =>
                  updateParams({
                    account: null,
                    tag: null,
                    preset: 'last-3-months',
                    startDate: null,
                    endDate: null,
                  })
                }
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Custom Date Range Inputs */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
            <label className="text-xs text-[var(--text-secondary)] font-medium">From:</label>
            <input
              className="text-xs border border-[var(--border)] rounded-md px-2 py-1 h-7 bg-[var(--bg-card)] text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              type="date"
              value={startDate}
              onChange={(e) => updateParams({ startDate: e.target.value })}
            />
            <label className="text-xs text-[var(--text-secondary)] font-medium">To:</label>
            <input
              className="text-xs border border-[var(--border)] rounded-md px-2 py-1 h-7 bg-[var(--bg-card)] text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              type="date"
              value={endDate}
              onChange={(e) => updateParams({ endDate: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
