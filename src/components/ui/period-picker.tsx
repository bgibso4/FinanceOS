'use client';

import React from 'react';
import { MonthGrid, PeriodStepper, YearList, monthValue } from './period-stepper';

type PeriodPickerProps = {
  mode: 'month' | 'year';
  /** 'YYYY-MM' in month mode, 'YYYY' in year mode. */
  value: string;
  onChange: (value: string) => void;
  /** First year listed in year mode (defaults to the current year). */
  minYear?: number;
  /** Last year selectable in year mode (defaults to the current year). */
  maxYear?: number;
  now?: Date;
};

export function PeriodPicker({ mode, value, onChange, minYear, maxYear, now }: PeriodPickerProps) {
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
      : year + 1 > (maxYear ?? today.getFullYear());

  const firstYear = minYear ?? today.getFullYear();
  const lastYear = maxYear ?? today.getFullYear();
  const years = Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, i) =>
    String(firstYear + i)
  );

  return (
    <PeriodStepper
      label={label}
      nextDisabled={nextIsFuture}
      popover={(close) => {
        const pick = (next: string) => {
          onChange(next);
          close();
        };
        return mode === 'month' ? (
          <MonthGrid today={today} value={value} onPick={pick} />
        ) : (
          <YearList value={value} years={years} onPick={pick} />
        );
      }}
      onNext={() => onChange(step(1))}
      onPrev={() => onChange(step(-1))}
    />
  );
}
