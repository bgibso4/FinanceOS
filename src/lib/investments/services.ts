import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@/lib/clock';
import { PriceRefresher, type Sleeper } from '@/lib/prices/refresh';
import type { PriceProvider } from '@/lib/prices/types';
import { ValueHistoryService } from './history';
import { ManualHoldingService } from './manual-holding';
import { InvestmentRefreshService } from './refresh';
import { ValuationService } from './valuation';

export type InvestmentServices = {
  prices: PriceRefresher;
  manualHoldings: ManualHoldingService;
  valuation: ValuationService;
  history: ValueHistoryService;
  refresh: InvestmentRefreshService;
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
  const manualHoldings = new ManualHoldingService(prisma, clock);
  const valuation = new ValuationService(prisma, manualHoldings, clock);
  return {
    prices,
    manualHoldings,
    valuation,
    history: new ValueHistoryService(prisma),
    refresh: new InvestmentRefreshService(prices, valuation),
  };
}

let instance: InvestmentServices | null = null;

/**
 * Production services: the app Prisma client and Yahoo, built on first use. Both load lazily so
 * code paths that never price don't import `yahoo-finance2`.
 */
export async function getInvestmentServices(): Promise<InvestmentServices> {
  if (!instance) {
    const [{ prisma }, { YahooPriceProvider }] = await Promise.all([
      import('@/lib/prisma'),
      import('../prices/yahoo'),
    ]);
    instance ??= createInvestmentServices({ prisma, provider: new YahooPriceProvider() });
  }
  return instance;
}
