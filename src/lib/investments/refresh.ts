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
   * Price a fund by its institution, following a public fund (null follows none; a fund switched
   * to market pricing comes back this way), price every market fund the switch made anyone follow
   * back to their history start, and revalue valued accounts that hold the fund or a follower
   * re-pointed by the switch. Holders are revalued even if pricing stops: institution and
   * proxied-institution pricing never drop days, and the next refresh prices the followed fund.
   */
  setProxy(id: string, symbol: string | null): Promise<Security> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const { security, followed, repointed } = await this.catalog.setProxy(id, symbol);
      if (followed.length) await this.prices.refresh({ securityIds: followed });
      await this.revalueHolders(id, ...repointed);
      return security;
    });
  }

  /** Revalue every valued account that has held any of `securityIds`, from the first day held. */
  private async revalueHolders(...securityIds: string[]): Promise<void> {
    const found = await Promise.all(securityIds.map((id) => this.valuation.holdersOf(id)));
    const holders = found.filter((h): h is NonNullable<typeof h> => h !== null);
    if (!holders.length) return;
    await this.valuation.writeBalances({
      accountIds: [...new Set(holders.flatMap((h) => h.accountIds))],
      from: new Date(Math.min(...holders.map((h) => h.from.getTime()))),
    });
  }
}
