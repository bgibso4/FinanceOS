'use client';

import React, { useEffect, useId, useRef } from 'react';

export const DRAWER_WIDTH = 540; // px
// Literal so Tailwind sees it; pages add it to their content while the drawer is open.
export const DRAWER_PUSH_CLASS = 'min-[1100px]:pr-[540px]';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function Drawer({ open, onClose, title, subtitle, children }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      aria-labelledby={titleId}
      aria-modal="false"
      className="fixed bottom-0 right-0 top-0 z-40 flex w-[min(540px,100vw)] flex-col border-l border-[var(--border-hover)] bg-[var(--bg-elevated)] shadow-[-18px_0_40px_rgba(0,0,0,0.22)] outline-none"
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--text-primary)]" id={titleId}>
            {title}
          </h3>
          {subtitle && (
            <div className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{subtitle}</div>
          )}
        </div>
        <button
          aria-label="Close"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          type="button"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </aside>
  );
}
