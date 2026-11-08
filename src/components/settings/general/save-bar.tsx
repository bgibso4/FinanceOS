import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';

/** Sticky bar naming the unsaved changes, with Discard and Save changes. */
export function SaveBar({
  message,
  error,
  saving,
  onDiscard,
  onSave,
}: {
  message: string;
  error: string | null;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-4 mt-[18px] flex items-center justify-between gap-4 rounded-xl border border-[var(--border-hover)] bg-[var(--bg-card)] py-2.5 pl-[18px] pr-3 text-[13px] text-[var(--text-primary)] shadow-[0_6px_24px_rgba(0,0,0,0.08)]">
      <div>
        <div>{message}</div>
        {error && <div className={`text-xs ${ds.status.error.text}`}>{error}</div>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          className="px-3 py-1.5 text-[13px]"
          disabled={saving}
          variant="outline"
          onClick={onDiscard}
        >
          Discard
        </Button>
        <Button
          className="px-3 py-1.5 text-[13px]"
          disabled={saving}
          variant="accent"
          onClick={onSave}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
