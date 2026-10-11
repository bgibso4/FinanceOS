import { withSyncLock } from '@/lib/sync-common';
import type { PriceRefresher, PriceRefreshResult } from '@/lib/prices/refresh';
import type { AccountBalance, HoldingSnapshot } from '@prisma/client';
import type { HoldingInput, ValuationService } from './valuation';

const REFRESH_LOCK = 'investments:refresh';

export type InvestmentRefreshResult = PriceRefreshResult & { valuationRows: number };

/** Prices, then valued-account balances. One run at a time per process. */
export class InvestmentRefreshService {
  constructor(
    private readonly prices: PriceRefresher,
    private readonly valuation: ValuationService
  ) {}

  refresh(): Promise<InvestmentRefreshResult> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const prices = await this.prices.refresh();
      const valuationRows = await this.valuation.writeBalances();
      return { ...prices, valuationRows };
    });
  }

  /** Price the securities first so today's snapshot and balance can use their closes. */
  saveHoldings(
    accountId: string,
    holdings: HoldingInput[]
  ): Promise<{
    holdings: HoldingSnapshot[];
    balance: AccountBalance | null;
    prices: PriceRefreshResult;
  }> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const prices = await this.prices.refresh({ securityIds: holdings.map((h) => h.securityId) });
      const saved = await this.valuation.setHoldings(accountId, holdings);
      const balance = await this.valuation.latestBalance(accountId);
      return { holdings: saved, balance, prices };
    });
  }
}
