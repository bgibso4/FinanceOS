'use client';

/**
 * SyncProvider - Global sync event listener
 *
 * This component must be mounted in the app layout to keep the
 * cloud sync event listener active across all pages.
 * Without this, triggerSync() calls have no effect when the
 * SyncSettings component is not mounted.
 */

import { useSync } from '@/lib/cloud-sync';

export function SyncProvider({ children }: { children: React.ReactNode }) {
  // Using the hook registers the event listener for 'financeos-sync-trigger'
  // and handles the actual sync logic when events are dispatched
  useSync();

  return <>{children}</>;
}
