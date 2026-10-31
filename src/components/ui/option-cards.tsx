'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export type OptionCard<T extends string> = {
  value: T;
  title: string;
  description: string;
  disabled?: boolean;
};

type OptionCardsProps<T extends string> = {
  label: string;
  value: T;
  options: OptionCard<T>[];
  onChange: (value: T) => void;
};

export function OptionCards<T extends string>({
  label,
  value,
  options,
  onChange,
}: OptionCardsProps<T>) {
  return (
    <div aria-label={label} className="grid grid-cols-3 gap-2" role="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            aria-checked={on}
            aria-disabled={o.disabled ?? false}
            className={cn(
              'rounded-[9px] border bg-[var(--bg-base)] px-[11px] py-2.5 text-left',
              on
                ? 'border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent)]'
                : 'border-[var(--border-hover)]',
              o.disabled && 'cursor-not-allowed opacity-45'
            )}
            role="radio"
            type="button"
            onClick={() => {
              if (!o.disabled) onChange(o.value);
            }}
          >
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-primary)]">
              <span
                aria-hidden="true"
                className={cn(
                  'h-3 w-3 rounded-full border-[1.5px]',
                  on
                    ? 'border-[var(--accent)] bg-[var(--accent)] shadow-[inset_0_0_0_2.5px_var(--bg-base)]'
                    : 'border-[var(--text-muted)]'
                )}
              />
              {o.title}
            </span>
            <span className="mt-[3px] block text-[11px] leading-[1.4] text-[var(--text-muted)]">
              {o.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
