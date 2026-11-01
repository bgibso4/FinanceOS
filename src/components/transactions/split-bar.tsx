import React from 'react';

const COLORS = ['var(--accent)', 'var(--tag-teal)', 'var(--tag-blue)', 'var(--green)'];

export const splitColor = (i: number) => COLORS[i % COLORS.length];

/** Signed total in the drawer header's style, e.g. −$148.20 / +$20.00. */
export const signedMoney = (amount: number) =>
  `${amount < 0 ? '−' : '+'}$${Math.abs(amount).toFixed(2)}`;

export function Swatch({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-sm"
      style={{ background: splitColor(index) }}
    />
  );
}

/** One segment per part, sized by its share of the original amount. */
export function SplitBar({ amounts, total }: { amounts: number[]; total: number }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-[var(--bg-base)]">
      {amounts.map((a, i) => (
        <div
          key={i}
          style={{
            width: `${Math.min(100, Math.max(0, (a / total) * 100))}%`,
            background: splitColor(i),
          }}
        />
      ))}
    </div>
  );
}
