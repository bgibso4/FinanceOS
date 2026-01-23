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
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts?.filter((a: any) => a.isActive !== false) ?? []))
      .catch(() => {});
  }, []);

  const preset = (params.get('preset') as DateRangePreset) ?? 'last-3-months';
  const selectedAccount = params.get('account') ?? '';
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

  const activeFiltersCount = [selectedAccount].filter(Boolean).length;
  const currentPreset = presets.find((p) => p.id === preset);

  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Time Period Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {presets.map((p) => (
              <button
                key={p.id}
                className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
                  preset === p.id
                    ? 'bg-slate-900 dark:bg-slate-700 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
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
          <div className="flex items-center gap-2">
            {/* Account Quick Filter */}
            <select
              className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

            {/* Clear Filters */}
            {(selectedAccount || preset !== 'last-3-months') && (
              <button
                className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1"
                onClick={() =>
                  updateParams({
                    account: null,
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
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            <label className="text-sm text-slate-600 dark:text-slate-400 font-medium">From:</label>
            <input
              className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              type="date"
              value={startDate}
              onChange={(e) => updateParams({ startDate: e.target.value })}
            />
            <label className="text-sm text-slate-600 dark:text-slate-400 font-medium">To:</label>
            <input
              className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
