/**
 * Next.js calls register() once when the server starts. The scheduled sync starts only in the
 * Node runtime of a running production server: `next build` also runs with NODE_ENV=production,
 * and a pass there would call real banks.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return;
  }
  const { startScheduledSync, checkSyncDue } = await import('@/lib/scheduled-sync/scheduler');
  const { scheduledSyncEnabled } = await import('@/lib/scheduled-sync/schedule');
  const { runSyncPass, defaultPassDeps } = await import('@/lib/scheduled-sync/pass');
  const { prisma } = await import('@/lib/prisma');

  startScheduledSync({
    enabled: scheduledSyncEnabled(),
    check: () =>
      checkSyncDue({ prisma, runPass: async () => runSyncPass(await defaultPassDeps()) }),
  });
}
