import { useEffect, useState } from 'react';
import type { PassStep } from '@/lib/scheduled-sync/pass';

export type ScheduledSyncStatus = {
  enabled: boolean;
  lastFinishedAt: string | null;
  nextAround: string | null;
  failedSteps: PassStep[];
  needsAttention: boolean;
};

const CHANGED = 'financeos-scheduled-sync-status-changed';

/** Tells every status reader to re-read, e.g. after a reconnect or a sync finished. */
export const signalScheduledSyncChanged = () => window.dispatchEvent(new Event(CHANGED));

/** Reads the automatic-sync status on mount and again whenever `refetchKey` changes. */
export function useScheduledSyncStatus(refetchKey?: string): ScheduledSyncStatus | null {
  const [status, setStatus] = useState<ScheduledSyncStatus | null>(null);

  const [signals, setSignals] = useState(0);

  useEffect(() => {
    const onChanged = () => setSignals((n) => n + 1);
    window.addEventListener(CHANGED, onChanged);
    return () => window.removeEventListener(CHANGED, onChanged);
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/api/scheduled-sync/status')
      .then((r) => r.json())
      // An error answer (`{ error }`) has no `enabled`; show nothing rather than a wrong line.
      .then((data) => live && typeof data.enabled === 'boolean' && setStatus(data))
      .catch((error) => console.error('Failed to read automatic sync status:', error));
    return () => {
      live = false;
    };
  }, [refetchKey, signals]);

  return status;
}
