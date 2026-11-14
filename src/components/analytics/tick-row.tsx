'use client';

export type Ticked = boolean | 'mixed';

type TickRowProps = {
  label: string;
  checked: Ticked;
  onToggle: () => void;
  /** Shown muted at the row's end, e.g. a group's total. */
  aside?: string;
  indent?: boolean;
};

/** One tick-box row in the filter panel's lists (categories, accounts, tags). */
export function TickRow({ label, checked, onToggle, aside, indent }: TickRowProps) {
  const on = checked !== false;
  return (
    <button
      aria-checked={checked}
      className={`flex w-full items-center gap-2 rounded-md py-1 pr-0.5 text-left text-[13px] hover:text-[var(--text-primary)] ${
        indent ? 'pl-8' : 'pl-0.5'
      } ${on ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
      role="checkbox"
      type="button"
      onClick={onToggle}
    >
      <span
        aria-hidden="true"
        className={`grid h-3.5 w-3.5 flex-none place-items-center rounded-[4px] border-[1.5px] ${
          on ? 'border-[var(--accent)]' : 'border-[var(--text-muted)]'
        } ${checked === true ? 'bg-[var(--accent)]' : ''}`}
      >
        {checked === true && (
          <svg
            fill="none"
            height="9"
            stroke="white"
            strokeWidth="2.2"
            viewBox="0 0 12 12"
            width="9"
          >
            <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {checked === 'mixed' && <span className="h-0.5 w-2 rounded-full bg-[var(--accent)]" />}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {aside && (
        <small className="ml-auto pl-2 font-mono text-[11px] font-normal text-[var(--text-muted)]">
          {aside}
        </small>
      )}
    </button>
  );
}
