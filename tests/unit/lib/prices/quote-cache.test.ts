import { describe, it, expect, vi } from 'vitest';
import type { Clock } from '@/lib/clock';
import { QuoteCache } from '@/lib/prices/quote-cache';
import type { QuoteSource } from '@/lib/prices/types';

function source(): QuoteSource {
  return {
    getQuote: vi.fn(async (symbol: string) => ({
      symbol,
      price: 10,
      currency: 'USD',
      asOf: new Date('2026-10-09T20:00:00Z'),
    })),
  };
}

/** A clock the test moves by hand: `clock.ms` is the current epoch milliseconds. */
function mutableClock(): Clock & { ms: number } {
  return {
    ms: 0,
    now() {
      return new Date(this.ms);
    },
  };
}

describe('QuoteCache', () => {
  it('serves a repeat request within 15 minutes from the cache', async () => {
    const s = source();
    const clock = mutableClock();
    const cache = new QuoteCache(s, clock);
    await cache.get('VTI');
    clock.ms = 14 * 60 * 1000;
    await cache.get('VTI');
    expect(s.getQuote).toHaveBeenCalledTimes(1);
  });

  it('refetches after 15 minutes', async () => {
    const s = source();
    const clock = mutableClock();
    const cache = new QuoteCache(s, clock);
    await cache.get('VTI');
    clock.ms = 15 * 60 * 1000;
    await cache.get('VTI');
    expect(s.getQuote).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const s = source();
    const clock = mutableClock();
    const cache = new QuoteCache(s, clock);
    vi.mocked(s.getQuote).mockRejectedValueOnce(new Error('fetch failed'));
    await expect(cache.get('VTI')).rejects.toThrow('fetch failed');
    clock.ms = 1;
    await cache.get('VTI');
    expect(s.getQuote).toHaveBeenCalledTimes(2);
  });
});
