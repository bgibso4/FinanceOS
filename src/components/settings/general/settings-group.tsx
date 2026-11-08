import type { ReactNode } from 'react';

/** A small uppercase caption over a card of rows. */
export function SettingsGroup({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <section className="mb-[30px] last:mb-0">
      <h2 className="mx-0.5 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {caption}
      </h2>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        {children}
      </div>
    </section>
  );
}

/** One setting: its label and optional one-line description on the left, its control on the right. */
export function SettingsRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-t border-[var(--border)] px-[18px] py-[15px] first:border-t-0">
      <div>
        <div className="font-medium text-[var(--text-primary)]">{label}</div>
        {description && <div className="mt-px text-xs text-[var(--text-muted)]">{description}</div>}
      </div>
      {control}
    </div>
  );
}

/** The quiet strip closing a card: a note on the left, an optional action on the right. */
export function SettingsFooter({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--bg-elevated)] px-[18px] py-2.5 text-xs text-[var(--text-muted)]">
      <div>{children}</div>
      {action}
    </div>
  );
}
