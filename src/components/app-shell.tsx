'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SideNav } from './side-nav';
import { FilterRibbon } from './filter-ribbon';
import { ChatAnalyst } from './chat-analyst';
import { SyncProvider } from './sync-provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showFilters = pathname === '/' || pathname.startsWith('/transactions');
  const [analystOpen, setAnalystOpen] = useState(false);

  const toggleAnalyst = useCallback(() => {
    setAnalystOpen((prev) => !prev);
  }, []);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleAnalyst();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleAnalyst]);

  return (
    <SyncProvider>
      <div className="flex min-h-screen bg-[var(--bg-base)]">
        <Suspense
          fallback={<div className="w-14 bg-[var(--bg-surface)] border-r border-[var(--border)]" />}
        >
          <SideNav onToggleAnalyst={toggleAnalyst} />
        </Suspense>
        <div className="flex min-h-screen flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-card)]/80 px-4 py-3 backdrop-blur">
            <div className="flex flex-col">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                Personal Finance Cockpit
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Analytics-first dashboard with auto-categorized spend
              </div>
            </div>
          </div>
          {showFilters && (
            <Suspense fallback={<div className="h-12 border-b border-[var(--border)]" />}>
              <FilterRibbon />
            </Suspense>
          )}
          <div className="flex-1 flex justify-center">
            <main className="w-full max-w-[1200px] px-12 py-8">{children}</main>
          </div>
        </div>
        <ChatAnalyst open={analystOpen} onClose={() => setAnalystOpen(false)} />
      </div>
    </SyncProvider>
  );
}
