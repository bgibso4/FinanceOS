import { cn } from '@/lib/cn';

type Option<T extends string> = { value: T; label: string };

/** A row of mutually exclusive choices on a track, e.g. Light / Dark / System. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div
      aria-label={label}
      className="inline-flex rounded-[9px] bg-[var(--track-bg)] p-0.5"
      role="radiogroup"
    >
      {options.map((o) => (
        <button
          key={o.value}
          aria-checked={value === o.value}
          className={cn(
            'rounded-[7px] px-3.5 py-[5px] text-[13px]',
            value === o.value
              ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[var(--bg-elevated)] dark:shadow-none'
              : 'text-[var(--text-secondary)]'
          )}
          role="radio"
          type="button"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
