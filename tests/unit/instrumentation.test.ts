import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { startScheduledSync } = vi.hoisted(() => ({ startScheduledSync: vi.fn() }));
vi.mock('@/lib/scheduled-sync/scheduler', () => ({
  startScheduledSync,
  checkSyncDue: vi.fn(),
}));
vi.mock('@/lib/scheduled-sync/pass', () => ({ runSyncPass: vi.fn(), defaultPassDeps: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { register } from '@/instrumentation';

function stub(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

describe('register', () => {
  beforeEach(() => startScheduledSync.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it('startsInTheProductionNodeServer', async () => {
    stub({ NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-server', NODE_ENV: 'production' });
    await register();
    expect(startScheduledSync).toHaveBeenCalledTimes(1);
  });

  it('neverStartsInTheEdgeRuntime', async () => {
    stub({ NEXT_RUNTIME: 'edge', NODE_ENV: 'production' });
    await register();
    expect(startScheduledSync).not.toHaveBeenCalled();
  });

  it('neverStartsDuringNextBuild', async () => {
    stub({ NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-build', NODE_ENV: 'production' });
    await register();
    expect(startScheduledSync).not.toHaveBeenCalled();
  });

  it.each(['development', 'test'])('neverStartsInA%sServer', async (nodeEnv) => {
    stub({ NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-server', NODE_ENV: nodeEnv });
    await register();
    expect(startScheduledSync).not.toHaveBeenCalled();
  });

  it('neverStartsWhenSwitchedOff', async () => {
    stub({ NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', SCHEDULED_SYNC: 'off' });
    await register();
    expect(startScheduledSync).not.toHaveBeenCalled();
  });
});
