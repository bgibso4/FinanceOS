'use client';

import React, { useState } from 'react';
import { ds } from '@/lib/design-system';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type PeriodPickerProps = {
  mode: 'month' | 'year';
  /** 'YYYY-MM' in month mode, 'YYYY' in year mode. */
  value: string;
  onChange: (value: string) => void;
  /** First year listed in year mode (defaults to the current year). */
  minYear?: number;
  now?: Date;
};

const monthValue = (year: number, monthIndex: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

export function PeriodPicker({ mode, value, onChange, minYear, now }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(0);
  const today = now ?? new Date();
  const [year, month] = value.split('-').map(Number);

  const label =
    mode === 'month'
      ? new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : String(year);

  const step = (delta: number) =>
    mode === 'month'
      ? ((d) => monthValue(d.getFullYear(), d.getMonth()))(new Date(year, month - 1 + delta))
      : String(year + delta);

  const nextIsFuture =
    mode === 'month'
      ? new Date(year, month) > today // start of the next month
      : year + 1 > today.getFullYear();

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const years = Array.from(
    { length: Math.max(0, today.getFullYear() - (minYear ?? today.getFullYear()) + 1) },
    (_, i) => (minYear ?? today.getFullYear()) + i
  );

  return (
    <div className="relative flex items-center gap-1">
      <button
        aria-label="Previous period"
        className={`p-2 rounded-lg transition-colors ${ds.interactive.default}`}
        onClick={() => onChange(step(-1))}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
      </button>

      <button
        className={`px-4 py-2 ${ds.bg.primary} border ${ds.border.default} rounded-lg font-semibold ${ds.text.primary} ${ds.bg.hover} transition-colors min-w-[180px] text-center flex items-center justify-center gap-2`}
        onClick={() => {
          setPickerYear(year);
          setOpen(!open);
        }}
      >
        {label}
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
      </button>

      <button
        aria-label="Next period"
        className={`p-2 rounded-lg transition-colors ${ds.interactive.default}`}
        disabled={mode === 'year' && nextIsFuture}
        onClick={() => !nextIsFuture && onChange(step(1))}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute top-full right-0 mt-2 ${ds.bg.primary} border ${ds.border.default} rounded-xl shadow-lg p-4 z-50`}
        >
          {mode === 'month' ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <button
                  className={`p-1 rounded ${ds.interactive.default}`}
                  onClick={() => setPickerYear(pickerYear - 1)}
                >
                  ←
                </button>
                <span className={`font-semibold ${ds.text.primary}`}>{pickerYear}</span>
                <button
                  className={`p-1 rounded ${ds.interactive.default}`}
                  onClick={() => setPickerYear(pickerYear + 1)}
                >
                  →
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {MONTHS.map((name, idx) => {
                  const monthStr = monthValue(pickerYear, idx);
                  const isFuture = new Date(pickerYear, idx) > today;
                  return (
                    <PeriodCell
                      key={name}
                      disabled={isFuture}
                      label={name}
                      selected={monthStr === value}
                      onClick={() => select(monthStr)}
                    />
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {years.map((y) => (
                <PeriodCell
                  key={y}
                  label={String(y)}
                  selected={String(y) === value}
                  onClick={() => select(String(y))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeriodCell({
  label,
  selected,
  disabled = false,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        selected
          ? 'bg-[var(--accent)] text-white'
          : disabled
            ? `${ds.text.muted} cursor-not-allowed`
            : `${ds.text.secondary} ${ds.bg.hover}`
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
