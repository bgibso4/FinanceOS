import { useEffect, useState } from 'react';

export type ScheduledSyncStatus = {
  enabled: boolean;
  lastFinishedAt: string | null;
  nextAround: string | null;
  failedSteps: ('rates' | 'accounts' | 'prices')[];
  needsAttention: boolean;
};

/** Reads the automatic-sync status on mount and again whenever `refetchKey` changes. */
export function useScheduledSyncStatus(refetchKey?: string): ScheduledSyncStatus | null {
  const [status, setStatus] = useState<ScheduledSyncStatus | null>(null);

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
  }, [refetchKey]);

  return status;
}
