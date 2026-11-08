/**
 * Decides when to call the sync pass. The pass writes its own record; this only asks "is one due?"
 * on a timer and never lets a failure escape it.
 */
import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import type { PassSummary } from './pass';
import { readPassRecord } from './record';
import { isDue } from './schedule';

export const CHECK_EVERY_MS = 15 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 30 * 1000;

export type CheckDeps = {
  prisma: PrismaClient;
  runPass(): Promise<PassSummary>;
  clock?: Clock;
};

/** Runs a pass when the last finished one is old enough. Never rejects. */
export async function checkSyncDue(deps: CheckDeps): Promise<void> {
  try {
    const record = await readPassRecord(deps.prisma);
    if (!isDue(record?.finishedAt ?? null, (deps.clock ?? systemClock).now())) return;
    const { failures } = await deps.runPass();
    if (failures.length > 0) console.warn(`Scheduled sync: failed steps: ${failures.join(', ')}`);
  } catch (error) {
    console.error('Scheduled sync: pass did not finish:', error);
  }
}

let started = false;

/** Starts the timers once per process; the first check runs shortly after start, then every 15 minutes. */
export function startScheduledSync(deps: { enabled: boolean; check(): Promise<void> }): void {
  if (!deps.enabled || started) return;
  started = true;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deps.check();
    } catch (error) {
      console.error('Scheduled sync: check failed:', error);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, FIRST_CHECK_AFTER_MS).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
