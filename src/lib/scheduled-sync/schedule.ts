/** When a scheduled sync pass runs. */
export const PASS_EVERY_MS = 4 * 60 * 60 * 1000;

/** Only the production server syncs on a schedule, so a dev server on a copy never advances a bank cursor. */
export function scheduledSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && env.SCHEDULED_SYNC !== 'off';
}

export function isDue(lastFinishedAt: Date | null, now: Date): boolean {
  return !lastFinishedAt || now.getTime() - lastFinishedAt.getTime() >= PASS_EVERY_MS;
}
