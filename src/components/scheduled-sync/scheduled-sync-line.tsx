'use client';

import { fmtMoment } from '@/lib/dates';
import { ds } from '@/lib/design-system';
import { useScheduledSyncStatus } from './use-scheduled-sync-status';

import type { ScheduledSyncStatus } from './use-scheduled-sync-status';

const STEP_NAMES: Record<ScheduledSyncStatus['failedSteps'][number], string> = {
  rates: 'exchange rates',
  accounts: 'accounts',
  prices: 'prices',
};

function describe(status: ScheduledSyncStatus): string {
  if (!status.enabled) return 'Automatic sync is off';
  if (!status.lastFinishedAt) return "Automatic sync hasn't run yet";
  const next = status.nextAround ? ` · next around ${fmtMoment(status.nextAround)}` : '';
  return `Synced automatically · last run ${fmtMoment(status.lastFinishedAt)}${next}`;
}

export function ScheduledSyncLine() {
  const status = useScheduledSyncStatus();
  if (!status) return null;
  const failed = status.failedSteps.map((step) => STEP_NAMES[step]).join(', ');
  return (
    <p className={`mb-3 text-xs ${ds.text.muted}`}>
      <span>{describe(status)}</span>
      {failed && <span className={ds.status.warning.text}>{` · couldn't update ${failed}`}</span>}
    </p>
  );
}
