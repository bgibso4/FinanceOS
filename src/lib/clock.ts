/** The current time, injected so services and tests agree on "today". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock frozen at `iso` (tests). */
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
