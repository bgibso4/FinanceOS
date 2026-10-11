import { withSyncLock } from '@/lib/sync-common';
import type { PriceRefresher, PriceRefreshResult } from '@/lib/prices/refresh';
import type { ValuationService } from './valuation';

export type InvestmentRefreshResult = PriceRefreshResult & { valuationRows: number };

/** Prices, then valued-account balances. One run at a time per process. */
export class InvestmentRefreshService {
  constructor(
    private readonly prices: PriceRefresher,
    private readonly valuation: ValuationService
  ) {}

  refresh(): Promise<InvestmentRefreshResult> {
    return withSyncLock('investments:refresh', async () => {
      const prices = await this.prices.refresh();
      const valuationRows = await this.valuation.writeBalances();
      return { ...prices, valuationRows };
    });
  }
}
