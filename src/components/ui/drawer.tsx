import React from 'react';
import { cn } from '@/lib/cn';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-40 flex justify-end bg-black/50 transition-opacity',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      <div className="h-full w-full max-w-md translate-x-0 bg-[var(--bg-card)] border-l border-[var(--border)] transition-transform">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="h-[calc(100%-56px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
