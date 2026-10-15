import { withSyncLock } from '@/lib/sync-common';
import type { PriceRefresher, PriceRefreshResult } from '@/lib/prices/refresh';
import type { SecurityCatalog } from '@/lib/prices/securities';
import type { AccountBalance, HoldingSnapshot, Security } from '@prisma/client';
import type { HoldingInput, ValuationService } from './valuation';

const REFRESH_LOCK = 'investments:refresh';

export type InvestmentRefreshResult = PriceRefreshResult & { valuationRows: number };

/**
 * Prices, then valued-account balances. One run at a time per process: every write that touches
 * prices or valued balances (refresh, holdings, symbol fixes, manual prices) shares one lock.
 */
export class InvestmentRefreshService {
  constructor(
    private readonly prices: PriceRefresher,
    private readonly valuation: ValuationService,
    private readonly catalog: Pick<
      SecurityCatalog,
      'setPriceSymbol' | 'setManualPrice' | 'setProxy'
    >
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

  /**
   * Point a security at a new market symbol, price it under that symbol and revalue its history.
   * If pricing stops, the history is left as it was: revaluing without the new closes would
   * drop those days. The next refresh prices the symbol.
   */
  setPriceSymbol(id: string, symbol: string): Promise<Security> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const security = await this.catalog.setPriceSymbol(id, symbol);
      const prices = await this.prices.refresh({ securityIds: [id] });
      if (prices.stopped) return security;
      await this.revalueHolders(id);
      return security;
    });
  }

  /** Price a security by hand from today and revalue. */
  setManualPrice(id: string, price: number): Promise<Security> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const security = await this.catalog.setManualPrice(id, price);
      await this.valuation.writeBalances();
      return security;
    });
  }

  /**
   * Make an institution-priced fund follow a public fund (null stops following), price that fund
   * back to the follower's history start, and revalue valued accounts that hold the follower. If
   * pricing stops, the link stays and the next refresh prices it.
   */
  setProxy(id: string, symbol: string | null): Promise<Security> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const security = await this.catalog.setProxy(id, symbol);
      if (security.proxySecurityId) {
        const prices = await this.prices.refresh({ securityIds: [security.proxySecurityId] });
        if (prices.stopped) return security;
      }
      await this.revalueHolders(id);
      return security;
    });
  }

  /** Revalue every valued account that has held `securityId`, from the first day it did. */
  private async revalueHolders(securityId: string): Promise<void> {
    const holders = await this.valuation.holdersOf(securityId);
    if (holders) await this.valuation.writeBalances(holders);
  }
}
