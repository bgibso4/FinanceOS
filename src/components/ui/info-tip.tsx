'use client';

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Wraps a caption with a faint dotted underline and explains it in a small tooltip on hover or
 * keyboard focus (Escape dismisses). `align` pins the tooltip to the caption's start or end edge,
 * so a right-aligned column's tip does not overflow its card.
 */
export function InfoTip({
  text,
  children,
  align = 'start',
}: {
  text: string;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <span
      aria-describedby={open ? id : undefined}
      className="relative inline-block cursor-help rounded-[2px] underline decoration-[var(--text-muted)] decoration-dotted underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-hover)]"
      tabIndex={0}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          className="pointer-events-none absolute z-10 block w-max max-w-[240px] whitespace-normal rounded-[6px] bg-[var(--text-primary)] px-[7px] py-[3px] text-left text-[11px] font-normal normal-case leading-snug text-[var(--bg-card)] no-underline"
          id={id}
          role="tooltip"
          style={{ bottom: 'calc(100% + 6px)', ...(align === 'end' ? { right: 0 } : { left: 0 }) }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
