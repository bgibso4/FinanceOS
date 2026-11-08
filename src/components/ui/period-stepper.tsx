'use client';

import React, { useState, type ReactNode } from 'react';
import { ds } from '@/lib/design-system';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthValue = (year: number, monthIndex: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

type PeriodStepperProps = {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  /** When given, clicking the label calls this instead of opening the popover. */
  onLabelClick?: () => void;
  /** Content shown under the label; call `close` to dismiss it. */
  popover?: (close: () => void) => ReactNode;
};

export function PeriodStepper({
  label,
  onPrev,
  onNext,
  nextDisabled,
  onLabelClick,
  popover,
}: PeriodStepperProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-1">
      <button
        aria-label="Previous period"
        className={`p-2 rounded-lg transition-colors ${ds.interactive.default}`}
        onClick={onPrev}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
      </button>

      <button
        className={`px-4 py-2 ${ds.bg.primary} border ${ds.border.default} rounded-lg font-semibold ${ds.text.primary} ${ds.bg.hover} transition-colors min-w-[180px] text-center flex items-center justify-center gap-2`}
        onClick={onLabelClick ?? (() => setOpen(!open))}
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
        disabled={nextDisabled}
        onClick={onNext}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
      </button>

      {open && popover && (
        <div
          className={`absolute top-full right-0 mt-2 ${ds.bg.primary} border ${ds.border.default} rounded-xl shadow-lg p-4 z-50`}
        >
          {popover(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Month picker with year arrows; future months are disabled. `value` is 'YYYY-MM'. */
export function MonthGrid({
  value,
  onPick,
  today,
}: {
  value: string;
  onPick: (ym: string) => void;
  today: Date;
}) {
  const [pickerYear, setPickerYear] = useState(Number(value.split('-')[0]));

  return (
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
          return (
            <PeriodCell
              key={name}
              disabled={new Date(pickerYear, idx) > today}
              label={name}
              selected={monthStr === value}
              onClick={() => onPick(monthStr)}
            />
          );
        })}
      </div>
    </>
  );
}

/** Year picker. Years and `value` are 'YYYY' strings, like MonthGrid's 'YYYY-MM'. */
export function YearList({
  value,
  years,
  onPick,
}: {
  value: string;
  years: string[];
  onPick: (year: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {years.map((y) => (
        <PeriodCell key={y} label={y} selected={y === value} onClick={() => onPick(y)} />
      ))}
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
