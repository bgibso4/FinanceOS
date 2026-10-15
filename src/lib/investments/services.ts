import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@/lib/clock';
import { PriceRefresher, type Sleeper } from '@/lib/prices/refresh';
import { QuoteCache } from '@/lib/prices/quote-cache';
import { SecurityCatalog } from '@/lib/prices/securities';
import type { PriceProvider } from '@/lib/prices/types';
import { CurrentHoldingsReader } from './current-holdings';
import { ValueHistoryService } from './history';
import { ManualHoldingService } from './manual-holding';
import { InvestmentOverviewService } from './overview';
import { InvestmentRefreshService } from './refresh';
import { ensureStoredCodes } from './rename-stored-codes';
import { ValuationService } from './valuation';

export type InvestmentServices = {
  prices: PriceRefresher;
  quotes: QuoteCache;
  catalog: SecurityCatalog;
  manualHoldings: ManualHoldingService;
  valuation: ValuationService;
  history: ValueHistoryService;
  refresh: InvestmentRefreshService;
  overview: InvestmentOverviewService;
};

/** The one place investment services are wired. Omitted `clock`/`sleep` use the real ones. */
export function createInvestmentServices(deps: {
  prisma: PrismaClient;
  provider: PriceProvider;
  clock?: Clock;
  sleep?: Sleeper;
}): InvestmentServices {
  const { prisma, provider, clock, sleep } = deps;
  const prices = new PriceRefresher(prisma, provider, clock, sleep);
  const quotes = new QuoteCache(provider, clock);
  const catalog = new SecurityCatalog(prisma, provider, quotes, clock);
  const manualHoldings = new ManualHoldingService(prisma, clock);
  const valuation = new ValuationService(prisma, manualHoldings, clock);
  const history = new ValueHistoryService(prisma);
  return {
    prices,
    quotes,
    catalog,
    manualHoldings,
    valuation,
    history,
    refresh: new InvestmentRefreshService(prices, valuation, catalog),
    overview: new InvestmentOverviewService(
      prisma,
      history,
      new CurrentHoldingsReader(prisma),
      prices,
      provider.symbolHint,
      clock
    ),
  };
}

let instance: InvestmentServices | null = null;

/**
 * Production services: the app Prisma client and the market data provider's gateway, built on
 * first use. Both load lazily so code paths that never price don't load the provider's client.
 * Stored codes from before the neutral codes are renamed first, once per process, so no service
 * ever reads an old value. `createInvestmentServices` (tests) never runs the rename.
 */
export async function getInvestmentServices(): Promise<InvestmentServices> {
  const { prisma } = await import('@/lib/prisma');
  await ensureStoredCodes(prisma);
  if (!instance) {
    const { YahooPriceProvider } = await import('../prices/yahoo');
    instance ??= createInvestmentServices({ prisma, provider: new YahooPriceProvider() });
  }
  return instance;
}
