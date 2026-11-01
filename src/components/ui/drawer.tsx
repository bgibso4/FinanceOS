'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export const DRAWER_WIDTH = 540; // px
/**
 * Marker class pages put on their content while the drawer is open. The app shell's centring
 * wrapper pads itself by DRAWER_WIDTH when it contains it (≥1100px), so the page re-centres in
 * the space left and gives up its left margin before it narrows.
 */
export const DRAWER_PUSH_CLASS = 'drawer-push';
/** Slide and push share one duration and curve so the panel and the page move together. */
export const DRAWER_MOTION = 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]';
const DRAWER_MS = 300;
/**
 * Spread on layout containers whose bare background counts as empty space: a click that lands
 * on one of them itself (not on anything inside) closes an open drawer.
 */
export const DRAWER_DISMISS = { 'data-drawer-dismiss': '' } as const;

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  headerExtra?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  actions,
  footer,
  children,
}: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // While sliding out, keep showing what was last open: callers usually pass nothing once closed.
  const content = { title, subtitle, headerExtra, actions, footer, children };
  const lastOpen = useRef(content);
  if (open) lastOpen.current = content;
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(false);
  const wasOpen = useRef(open);

  useLayoutEffect(() => {
    if (open) {
      wasOpen.current = true;
      setClosing(false);
      // Commit the off-screen position first so the slide-in transitions from it.
      panelRef.current?.getBoundingClientRect();
      setShown(true);
      return;
    }
    setShown(false);
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setClosing(true);
    const t = setTimeout(() => setClosing(false), DRAWER_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      onCloseRef.current();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.hasAttribute?.('data-drawer-dismiss')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open && !closing) return null;
  const view = open ? content : lastOpen.current;

  return (
    <aside
      ref={panelRef}
      aria-hidden={open ? undefined : true}
      aria-labelledby={titleId}
      aria-modal="false"
      className={`fixed bottom-0 right-0 top-0 z-40 flex w-[min(540px,100vw)] flex-col border-l border-[var(--border-hover)] bg-[var(--bg-elevated)] shadow-[-18px_0_40px_rgba(0,0,0,0.22)] outline-none transition-transform motion-reduce:transition-none ${DRAWER_MOTION} ${
        shown ? 'translate-x-0' : 'translate-x-full'
      }`}
      inert={!open}
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--text-primary)]" id={titleId}>
            {view.title}
          </h3>
          {view.subtitle && (
            <div className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{view.subtitle}</div>
          )}
          {view.headerExtra}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view.actions}
          <button
            aria-label="Close"
            className="grid h-8 w-[34px] place-items-center rounded-[9px] border border-[var(--border-hover)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
            title="Close · Esc"
            type="button"
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{view.children}</div>
      {view.footer && (
        <div className="border-t border-[var(--border)] px-5 py-3">{view.footer}</div>
      )}
    </aside>
  );
}
