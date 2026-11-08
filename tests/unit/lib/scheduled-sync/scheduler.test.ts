import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PASS_EVERY_MS } from '@/lib/scheduled-sync/schedule';
import { fixedClock } from '@/lib/clock';

// The scheduler keeps a once-per-process flag, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return import('@/lib/scheduled-sync/scheduler');
}

describe('startScheduledSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('doesNothingWhenDisabled', async () => {
    const { startScheduledSync, CHECK_EVERY_MS } = await load();
    const check = vi.fn().mockResolvedValue(undefined);
    startScheduledSync({ enabled: false, check });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(check).not.toHaveBeenCalled();
  });

  it('firstCheckRunsSoonAfterStart', async () => {
    const { startScheduledSync, CHECK_EVERY_MS } = await load();
    const check = vi.fn().mockResolvedValue(undefined);
    startScheduledSync({ enabled: true, check });
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('startsOnlyOnce', async () => {
    const { startScheduledSync } = await load();
    const check = vi.fn().mockResolvedValue(undefined);
    startScheduledSync({ enabled: true, check });
    startScheduledSync({ enabled: true, check });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('skipsWhileAPassRuns', async () => {
    const { startScheduledSync, CHECK_EVERY_MS } = await load();
    let finish!: () => void;
    const check = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    startScheduledSync({ enabled: true, check });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('aRejectedCheckNeverStopsTheTimer', async () => {
    const { startScheduledSync, CHECK_EVERY_MS } = await load();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const check = vi.fn().mockRejectedValue(new Error('boom'));
    startScheduledSync({ enabled: true, check });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(check.mock.calls.length).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('checkSyncDue', () => {
  const now = fixedClock('2026-11-08T12:00:00Z');
  const prismaWith = (finishedAt: Date | null) =>
    ({
      userSettings: {
        findFirst: vi.fn().mockResolvedValue(finishedAt && { scheduledSyncFinishedAt: finishedAt }),
      },
    }) as unknown as PrismaClient;
  const summary = (failures: string[] = []) => ({ finishedAt: now.now(), failures, units: [] });

  it('skipsWhenNotDue', async () => {
    const { checkSyncDue } = await load();
    const runPass = vi.fn();
    const recent = new Date(now.now().getTime() - (PASS_EVERY_MS - 60_000));
    await checkSyncDue({ prisma: prismaWith(recent), clock: now, runPass });
    expect(runPass).not.toHaveBeenCalled();
  });

  it('runsThePassWhenDue', async () => {
    const { checkSyncDue } = await load();
    const runPass = vi.fn().mockResolvedValue(summary());
    await checkSyncDue({ prisma: prismaWith(null), clock: now, runPass });
    expect(runPass).toHaveBeenCalledTimes(1);
  });

  it('warnsWhichStepsFailed', async () => {
    const { checkSyncDue } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await checkSyncDue({
      prisma: prismaWith(null),
      clock: now,
      runPass: vi.fn().mockResolvedValue(summary(['rates', 'prices'])),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rates, prices'));
    warn.mockRestore();
  });

  it('catchesAPassThatRejects', async () => {
    const { checkSyncDue } = await load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      checkSyncDue({
        prisma: prismaWith(null),
        clock: now,
        runPass: vi.fn().mockRejectedValue(new Error('record write failed')),
      })
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
