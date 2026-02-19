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
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Suspense
          fallback={
            <div className="w-56 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700" />
          }
        >
          <SideNav onToggleAnalyst={toggleAnalyst} />
        </Suspense>
        <div className="flex min-h-screen flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 px-4 py-3 backdrop-blur">
            <div className="flex flex-col">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Personal Finance Cockpit
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Analytics-first dashboard with auto-categorized spend
              </div>
            </div>
          </div>
          {showFilters && (
            <Suspense
              fallback={<div className="h-12 border-b border-slate-200 dark:border-slate-700" />}
            >
              <FilterRibbon />
            </Suspense>
          )}
          <main className="flex-1 p-4">{children}</main>
        </div>
        <ChatAnalyst open={analystOpen} onClose={() => setAnalystOpen(false)} />
      </div>
    </SyncProvider>
  );
}
