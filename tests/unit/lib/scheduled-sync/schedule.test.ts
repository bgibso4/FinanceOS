import { describe, it, expect } from 'vitest';
import { isDue, scheduledSyncEnabled, PASS_EVERY_MS } from '@/lib/scheduled-sync/schedule';

describe('schedule', () => {
  it('dueAfterFourHours', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(isDue(null, now)).toBe(true);
    expect(isDue(new Date(now.getTime() - (PASS_EVERY_MS - 60_000)), now)).toBe(false);
    expect(isDue(new Date(now.getTime() - PASS_EVERY_MS), now)).toBe(true);
  });

  it('neverStartsOutsideProduction', () => {
    expect(scheduledSyncEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(scheduledSyncEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(scheduledSyncEnabled({ NODE_ENV: 'production' })).toBe(true);
  });

  it('offSwitch', () => {
    expect(scheduledSyncEnabled({ NODE_ENV: 'production', SCHEDULED_SYNC: 'off' })).toBe(false);
  });
});
