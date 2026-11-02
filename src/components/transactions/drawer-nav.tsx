interface DrawerNavProps {
  index: number;
  count: number;
  onStep: (delta: -1 | 1) => void;
}

const stepButton =
  'grid h-8 w-[34px] place-items-center text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]';

function Chevron({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d={direction === 'up' ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

export function DrawerNav({ index, count, onStep }: DrawerNavProps) {
  if (index < 0) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-[var(--text-muted)]">
        {index + 1} of {count}
      </span>
      <div className="flex overflow-hidden rounded-[9px] border border-[var(--border-hover)] bg-[var(--bg-elevated)]">
        <button
          aria-label="Previous transaction"
          className={stepButton}
          disabled={index === 0}
          title="Previous · ↑"
          type="button"
          onClick={() => onStep(-1)}
        >
          <Chevron direction="up" />
        </button>
        <span aria-hidden="true" className="w-px bg-[var(--border-hover)]" />
        <button
          aria-label="Next transaction"
          className={stepButton}
          disabled={index >= count - 1}
          title="Next · ↓"
          type="button"
          onClick={() => onStep(1)}
        >
          <Chevron direction="down" />
        </button>
      </div>
      <span aria-hidden="true" className="h-[22px] w-px bg-[var(--border-hover)]" />
    </div>
  );
}
