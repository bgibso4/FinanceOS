'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { SideNav } from './side-nav';
import { ChatAnalyst } from './chat-analyst';
import { SyncProvider } from './sync-provider';
import { DRAWER_DISMISS, DRAWER_MOTION } from './ui/drawer';

export function AppShell({ children }: { children: React.ReactNode }) {
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
        <div className="flex min-h-screen flex-1 flex-col" {...DRAWER_DISMISS}>
          {/* A page holding DRAWER_PUSH_CLASS makes room for the drawer here, so the centred
              column re-centres in what is left: the left margin goes first, the content last. */}
          <div
            {...DRAWER_DISMISS}
            className={`flex flex-1 justify-center transition-[padding] motion-reduce:transition-none ${DRAWER_MOTION} min-[1100px]:has-[.drawer-push]:pr-[540px]`}
          >
            <div className="w-full max-w-[1400px] px-12 py-8" {...DRAWER_DISMISS}>
              <main {...DRAWER_DISMISS}>{children}</main>
            </div>
          </div>
        </div>
        <ChatAnalyst open={analystOpen} onClose={() => setAnalystOpen(false)} />
      </div>
    </SyncProvider>
  );
}
