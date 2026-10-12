'use client';

import type { AllocationSlice } from '@/lib/investments/holdings-view';

export function AllocationBars({ slices }: { slices: AllocationSlice[] }) {
  return (
    <div className="mt-2.5">
      {slices.map((s) => (
        <div
          key={s.label}
          className="grid grid-cols-[130px_1fr_52px] items-center gap-3 py-[5px] text-xs text-[var(--text-secondary)]"
        >
          <span className="truncate">{s.label}</span>
          <span className="h-[5px] rounded-[3px] bg-[var(--track-bg)]">
            <span
              className="block h-full rounded-[3px] bg-[var(--text-muted)] opacity-80"
              style={{ width: `${s.pct}%` }}
            />
          </span>
          <span className="text-right font-mono text-[11.5px] text-[var(--text-primary)]">
            {s.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
