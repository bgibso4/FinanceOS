import { describe, it, expect, vi } from 'vitest';

vi.mock('yahoo-finance2', () => ({ default: class {} }));

import { YahooPriceProvider, classifyYahooError, type YahooClient } from '@/lib/prices/yahoo';
import { utcDay } from '@/lib/investments/dates';

function client(over: Partial<YahooClient> = {}): YahooClient {
  return {
    chart: vi.fn(async () => ({ quotes: [], events: {} })),
    quote: vi.fn(async () => ({
      regularMarketPrice: 10,
      currency: 'USD',
      regularMarketTime: new Date('2026-10-09T20:00:00Z'),
    })),
    search: vi.fn(async () => ({ quotes: [] })),
    ...over,
  };
}

const FROM = utcDay('2026-10-05');
const TO = utcDay('2026-10-09');

describe('yahoo price provider', () => {
  it('tells the price window how to write its symbols', () => {
    expect(new YahooPriceProvider(client()).symbolHint).toBe(
      'Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.'
    );
  });

  it('requests one daily chart with events covering the inclusive range', async () => {
    const c = client();
    await new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO);
    expect(c.chart).toHaveBeenCalledTimes(1);
    expect(c.chart).toHaveBeenCalledWith('VTI', {
      period1: FROM,
      period2: utcDay('2026-10-10'),
      interval: '1d',
      events: 'div|split',
    });
  });

  it('maps closes to UTC days and drops null closes and out-of-range bars', async () => {
    const c = client({
      chart: vi.fn(async () => ({
        quotes: [
          { date: new Date('2026-10-08T13:30:00Z'), close: 101.5 },
          { date: new Date('2026-10-09T13:30:00Z'), close: null },
          { date: new Date('2026-10-12T13:30:00Z'), close: 105 },
        ],
      })),
    });
    const h = await new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO);
    expect(h.closes).toEqual([{ date: utcDay('2026-10-08'), close: 101.5 }]);
  });

  it('maps dividends and splits', async () => {
    const c = client({
      chart: vi.fn(async () => ({
        quotes: [],
        events: {
          dividends: [{ date: new Date('2026-10-06T13:30:00Z'), amount: 0.75 }],
          splits: [{ date: new Date('2026-10-07T13:30:00Z'), numerator: 4, denominator: 1 }],
        },
      })),
    });
    const h = await new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO);
    expect(h.events).toEqual([
      { date: utcDay('2026-10-06'), type: 'dividend', amount: 0.75, ratio: null },
      { date: utcDay('2026-10-07'), type: 'split', amount: null, ratio: 4 },
    ]);
  });

  it.each([
    ['Too Many Requests', 'rate_limited'],
    ['Request failed with status 429', 'rate_limited'],
    ['No data found, symbol may be delisted', 'unknown_symbol'],
    ['Not Found', 'unknown_symbol'],
    ['fetch failed', 'network'],
  ])('classifies "%s" as %s', (message, kind) => {
    expect(classifyYahooError(new Error(message))).toBe(kind);
  });

  /** Shaped like yahoo-finance2's error classes: a named Error with the library's message. */
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  it.each([
    [named('FailedYahooValidationError', 'Failed Yahoo Schema validation')],
    [named('InvalidOptionsError', 'yahooFinance.chart called with invalid options.')],
    [named('FailedYahooValidationError', 'unexpected payload')],
    [new Error('Failed Yahoo Schema validation')],
    [new Error('yahooFinance.chart called with invalid options.')],
  ])('classifies %s as bad_response', (error) => {
    expect(classifyYahooError(error)).toBe('bad_response');
  });

  it('wraps client errors in PriceProviderError', async () => {
    const c = client({
      chart: vi.fn(async () => {
        throw new Error('Too Many Requests');
      }),
    });
    await expect(new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO)).rejects.toMatchObject({
      name: 'PriceProviderError',
      kind: 'rate_limited',
    });
  });

  it('maps a quote', async () => {
    const q = await new YahooPriceProvider(client()).getQuote('VTI');
    expect(q).toEqual({
      symbol: 'VTI',
      price: 10,
      currency: 'USD',
      asOf: new Date('2026-10-09T20:00:00Z'),
    });
  });

  it('treats a quote without a price as an unknown symbol', async () => {
    const c = client({ quote: vi.fn(async () => ({})) });
    await expect(new YahooPriceProvider(c).getQuote('NOPE')).rejects.toMatchObject({
      kind: 'unknown_symbol',
    });
  });

  it('maps search results and ignores non-Yahoo entries', async () => {
    const c = client({
      search: vi.fn(async () => ({
        quotes: [
          {
            symbol: 'TEQ.TO',
            shortname: 'Test Equity ETF',
            quoteType: 'ETF',
            exchange: 'TOR',
            isYahooFinance: true,
          },
          { symbol: 'X', shortname: 'News', isYahooFinance: false },
        ],
      })),
    });
    expect(await new YahooPriceProvider(c).search('teq')).toEqual([
      { symbol: 'TEQ.TO', name: 'Test Equity ETF', type: 'etf', exchange: 'TOR' },
    ]);
  });
});
