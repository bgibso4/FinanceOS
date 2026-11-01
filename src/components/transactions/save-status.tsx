import type { SaveStatus as Status } from './use-autosave';

interface SaveStatusProps {
  status: Status;
  message: string | null;
  onRetry: () => void;
}

function Content({ status, message, onRetry }: SaveStatusProps) {
  switch (status) {
    case 'saved':
      return (
        <>
          <svg
            aria-hidden="true"
            fill="none"
            height="12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            width="12"
          >
            <path d="m5 12 5 5L20 7" />
          </svg>
          Saved
        </>
      );
    case 'editing':
      return <>Editing…</>;
    case 'saving':
      return (
        <>
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-hover)] border-t-[var(--text-secondary)]"
          />
          Saving…
        </>
      );
    case 'error':
      return (
        <span className="text-[var(--red)]">
          Couldn&apos;t save ·{' '}
          <button className="underline" type="button" onClick={onRetry}>
            Try again
          </button>
        </span>
      );
    case 'invalid':
      return <span className="text-[var(--red)]">{message}</span>;
  }
}

export function SaveStatus(props: SaveStatusProps) {
  return (
    <div
      aria-live="polite"
      className="flex items-center justify-end gap-1.5 text-xs text-[var(--text-muted)]"
    >
      <Content {...props} />
    </div>
  );
}
