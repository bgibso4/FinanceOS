'use client';

import type { ReactNode } from 'react';
import type { BalanceSource } from '@/lib/investments/overview';
import type { SeriesChange } from '@/lib/investments/portfolio-view';
import { changeText, toneOf, type Tone } from './format';

const PILL =
  'inline-flex items-center whitespace-nowrap rounded-full border px-[7px] py-px text-[10.5px] font-medium';

const SOURCE_PILLS: Record<BalanceSource, { label: string; className: string }> = {
  provider: {
    label: 'Plaid',
    className: 'text-[var(--tag-blue)] border-[color-mix(in_srgb,var(--tag-blue)_30%,transparent)]',
  },
  valuation: {
    label: 'Valued',
    className: 'text-[var(--tag-teal)] border-[color-mix(in_srgb,var(--tag-teal)_30%,transparent)]',
  },
  manual: {
    label: 'Manual',
    className: 'text-[var(--text-secondary)] border-[var(--border-hover)]',
  },
};

export function SourcePill({ source }: { source: BalanceSource }) {
  const pill = SOURCE_PILLS[source];
  return <span className={`${PILL} ${pill.className}`}>{pill.label}</span>;
}

const CHIP_TONES: Record<Tone, string> = {
  up: 'text-[var(--green)] bg-[color-mix(in_srgb,var(--green)_12%,transparent)]',
  down: 'text-[var(--red)] bg-[color-mix(in_srgb,var(--red)_12%,transparent)]',
  flat: 'text-[var(--text-muted)] bg-[var(--track-bg)]',
};

export function ChangeChip({ change }: { change: SeriesChange }) {
  return (
    <span
      className={`rounded-[5px] px-1.5 py-px font-mono text-[11px] ${CHIP_TONES[toneOf(change.pct)]}`}
    >
      {changeText(change)}
    </span>
  );
}

export function StatusDot({ tone, title }: { tone: 'warn' | 'err'; title: string }) {
  return (
    <span
      aria-label={title}
      className={`ml-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle ${
        tone === 'err' ? 'bg-[var(--red)]' : 'bg-[var(--accent)]'
      }`}
      role="img"
      title={title}
    />
  );
}

export function FlagPill({ children }: { children: ReactNode }) {
  return (
    <span
      className={`${PILL} ml-1.5 border-[color-mix(in_srgb,var(--accent)_35%,transparent)] font-sans text-[var(--accent)]`}
    >
      {children}
    </span>
  );
}

const NOTICE_TONES = {
  warn: 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] border-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
  err: 'bg-[color-mix(in_srgb,var(--red)_7%,transparent)] border-[color-mix(in_srgb,var(--red)_25%,transparent)]',
};

export function Notice({
  tone,
  lead,
  text,
  action,
}: {
  tone: 'warn' | 'err';
  lead: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={`mt-4 flex items-start gap-2.5 rounded-[9px] border px-3 py-2.5 text-xs leading-[1.45] text-[var(--text-secondary)] ${NOTICE_TONES[tone]}`}
      role="status"
    >
      <div className="grow">
        <b className="font-medium text-[var(--text-primary)]">{lead}</b> {text}
      </div>
      {action}
    </div>
  );
}
