import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import { createAccountData } from './factories';
import { fixedClock } from '@/lib/clock';
import { isoDay, utcDay } from '@/lib/investments/dates';
import { createInvestmentServices } from '@/lib/investments/services';
import {
  PriceProviderError,
  type PriceEvent,
  type PriceProvider,
  type SymbolMatch,
} from '@/lib/prices/types';

export const day = (iso: string) => utcDay(iso);

/** Sleeper for services under test: never waits. */
export const noSleep = async (_ms: number) => {};

export function seedInvestmentAccount(
  prisma: PrismaClient,
  over: { balanceSource?: string; currency?: string; type?: string; name?: string } = {}
) {
  return prisma.account.create({
    data: {
      ...createAccountData({
        type: over.type ?? 'brokerage',
        currency: over.currency ?? 'USD',
        name: over.name ?? 'Test Investments',
      }),
      trackingMode: 'investment',
      balanceSource: over.balanceSource ?? 'provider',
    },
  });
}

export function seedSecurity(
  prisma: PrismaClient,
  over: {
    name?: string;
    type?: string;
    currency?: string;
    priceSymbol?: string | null;
    pricing?: string;
    fixedPrice?: number | null;
  } = {}
) {
  const priceSymbol = over.priceSymbol === undefined ? 'TFND' : over.priceSymbol;
  return prisma.security.create({
    data: {
      name: over.name ?? 'Test Fund',
      ticker: priceSymbol,
      type: over.type ?? 'etf',
      currency: over.currency ?? 'USD',
      priceSymbol,
      pricing: over.pricing ?? 'feed',
      fixedPrice: over.fixedPrice ?? null,
    },
  });
}

export function seedSnapshot(
  prisma: PrismaClient,
  data: {
    accountId: string;
    securityId: string;
    date: string;
    quantity: number;
    price: number;
    source?: string;
  }
) {
  return prisma.holdingSnapshot.create({
    data: {
      accountId: data.accountId,
      securityId: data.securityId,
      date: day(data.date),
      quantity: data.quantity,
      price: data.price,
      value: data.quantity * data.price,
      source: data.source ?? 'plaid',
    },
  });
}

export function seedPrice(
  prisma: PrismaClient,
  securityId: string,
  date: string,
  close: number,
  source = 'yahoo'
) {
  return prisma.securityPrice.create({ data: { securityId, date: day(date), close, source } });
}

export function seedBalance(
  prisma: PrismaClient,
  accountId: string,
  date: string,
  balance: number,
  source = 'plaid'
) {
  return prisma.accountBalance.create({
    data: { accountId, date: day(date), balance, currency: 'USD', source },
  });
}

export function seedTrade(
  prisma: PrismaClient,
  data: {
    accountId: string;
    securityId?: string | null;
    date: string;
    type: string;
    quantity?: number | null;
    amount: number;
    isCancelled?: boolean;
  }
) {
  return prisma.investmentTransaction.create({
    data: {
      accountId: data.accountId,
      securityId: data.securityId ?? null,
      date: day(data.date),
      type: data.type,
      subtype: data.type,
      name: `Test ${data.type}`,
      quantity: data.quantity ?? null,
      amount: data.amount,
      currency: 'USD',
      source: 'plaid',
      isCancelled: data.isCancelled ?? false,
    },
  });
}

/**
 * In-memory PriceProvider. `closes[symbol][YYYY-MM-DD]` are the bars it knows; `errors[symbol]`
 * is a queue of errors thrown before it starts answering; `calls` records history requests.
 */
export function fakeProvider(
  opts: {
    closes?: Record<string, Record<string, number>>;
    events?: Record<string, PriceEvent[]>;
    errors?: Record<string, PriceProviderError[]>;
    currencies?: Record<string, string>;
    search?: Record<string, SymbolMatch[]>;
  } = {}
) {
  const calls: { symbol: string; from: string; to: string }[] = [];
  const errors = Object.fromEntries(
    Object.entries(opts.errors ?? {}).map(([symbol, list]) => [symbol, [...list]])
  );
  const provider: PriceProvider = {
    getDailyHistory: vi.fn(async (symbol: string, from: Date, to: Date) => {
      calls.push({ symbol, from: isoDay(from), to: isoDay(to) });
      const queued = errors[symbol]?.shift();
      if (queued) throw queued;
      const inRange = (d: string) => d >= isoDay(from) && d <= isoDay(to);
      return {
        closes: Object.entries(opts.closes?.[symbol] ?? {})
          .filter(([d]) => inRange(d))
          .map(([d, close]) => ({ date: day(d), close })),
        events: (opts.events?.[symbol] ?? []).filter((e) => inRange(isoDay(e.date))),
      };
    }),
    getQuote: vi.fn(async (symbol: string) => {
      const bars = opts.closes?.[symbol];
      if (!bars) throw new PriceProviderError('unknown_symbol', `Unknown symbol ${symbol}`);
      const last = Object.keys(bars).sort().at(-1)!;
      return {
        symbol,
        price: bars[last],
        currency: opts.currencies?.[symbol] ?? 'USD',
        asOf: day(last),
      };
    }),
    search: vi.fn(async (query: string) => opts.search?.[query] ?? []),
  };
  return { provider, calls };
}

/** Production wiring over the test client: fake price feed, frozen clock, no real sleeps. */
export function testServices(
  prisma: PrismaClient,
  providerOpts: Parameters<typeof fakeProvider>[0] = {},
  iso = '2026-10-09T22:00:00Z'
) {
  const { provider, calls } = fakeProvider(providerOpts);
  const services = createInvestmentServices({
    prisma,
    provider,
    clock: fixedClock(iso),
    sleep: noSleep,
  });
  return { services, calls };
}
