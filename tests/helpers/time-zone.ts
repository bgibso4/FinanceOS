import { afterAll, afterEach, beforeAll, vi } from 'vitest';

/** 10:30pm on Nov 6 in New York, when UTC has already reached Nov 7. */
export const NEW_YORK_EVENING = '2026-11-07T03:30:00.000Z';

/** Runs a describe block in New York, whatever zone the machine is in. */
export function inNewYork() {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** Freezes only the clock, so promises and timers still run. */
export function freezeClock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}
