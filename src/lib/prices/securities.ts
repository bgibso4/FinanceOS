import type { PrismaClient, Security } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { utcDay } from '@/lib/investments/dates';
import { isValidCurrency } from '@/lib/currency';
import { institutionPricedIds } from './price-book';
import type { QuoteCache } from './quote-cache';
import type { SymbolLookup, SymbolMatch } from './types';
import { PriceSource, Pricing, SecurityType } from '@/lib/investments/codes';

/** A security switched to institution pricing, and who now follows which market security. */
export type ProxyChange = {
  security: Security;
  /** Market securities the switch made anyone follow; they need pricing. */
  followed: string[];
  /** Securities that followed the switched one and now follow `followed` instead. */
  repointed: string[];
};

/** Finding, adding and repricing securities by hand (ticker search, symbol fixes, manual prices). */
export class SecurityCatalog {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly lookup: SymbolLookup,
    private readonly quotes: QuoteCache,
    private readonly clock: Clock = systemClock
  ) {}

  search(query: string): Promise<SymbolMatch[]> {
    return this.lookup.search(query);
  }

  /**
   * The market security priced under `symbol`, created (validated by a quote) when none exists.
   * `exclude` skips one security, e.g. one leaving that symbol.
   */
  async findOrCreateMarket(
    symbol: string,
    opts: { exclude?: string } = {}
  ): Promise<{ security: Security; created: boolean }> {
    const priceSymbol = symbol.trim().toUpperCase();
    const existing = await this.prisma.security.findFirst({
      where: { priceSymbol, ...(opts.exclude ? { id: { not: opts.exclude } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return { security: existing, created: false };

    const quote = await this.quotes.get(priceSymbol);
    let match: SymbolMatch | undefined;
    try {
      match = (await this.lookup.search(priceSymbol)).find(
        (m) => m.symbol.toUpperCase() === priceSymbol
      );
    } catch {
      match = undefined; // name/type are cosmetic; the quote already proved the symbol prices
    }
    const security = await this.prisma.security.create({
      data: {
        ticker: priceSymbol.split(/[.-]/)[0],
        name: match?.name ?? priceSymbol,
        type: match?.type ?? SecurityType.Other,
        currency: quote.currency,
        priceSymbol,
        priceSymbolOverride: true,
        pricing: Pricing.Market,
      },
    });
    return { security, created: true };
  }

  /**
   * The cash security for a currency (1 unit = 1 <currency>), shared with the aggregator's cash
   * securities.
   */
  async findOrCreateCash(currency: string): Promise<Security> {
    const code = currency.trim().toUpperCase();
    if (!isValidCurrency(code)) throw new InvestmentInputError(`Unsupported currency: ${currency}`);
    const existing = await this.prisma.security.findFirst({
      where: { type: SecurityType.Cash, pricing: Pricing.Fixed, fixedPrice: 1, currency: code },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return this.prisma.security.create({
      data: {
        name: `${code} cash`,
        ticker: null,
        type: SecurityType.Cash,
        currency: code,
        priceSymbol: null,
        priceSymbolOverride: true,
        pricing: Pricing.Fixed,
        fixedPrice: 1,
      },
    });
  }

  /**
   * Point a security at a new market symbol (validated by a quote) and drop the old symbol's data.
   * The new symbol's history is fetched from scratch, so fetch tracking resets too.
   * Callers reprice and revalue under the refresh lock (`InvestmentRefreshService.setPriceSymbol`).
   */
  async setPriceSymbol(id: string, symbol: string): Promise<Security> {
    await this.requireSecurity(id);
    const priceSymbol = symbol.trim().toUpperCase();
    await this.quotes.get(priceSymbol); // throws unknown_symbol → 400
    const [security] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: {
          priceSymbol,
          priceSymbolOverride: true,
          pricing: Pricing.Market,
          pricesFetchedFrom: null,
          proxySecurityId: null,
        },
      }),
      ...this.dropMarketData(id),
    ]);
    return security;
  }

  /** Price a security by hand from today. Callers revalue (`InvestmentRefreshService`). */
  async setManualPrice(id: string, price: number): Promise<Security> {
    await this.requireSecurity(id);
    const date = utcDay(this.clock.now());
    const [security] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: { pricing: Pricing.Manual, priceSymbolOverride: true },
      }),
      this.prisma.securityPrice.upsert({
        where: { securityId_date_source: { securityId: id, date, source: PriceSource.Manual } },
        create: { securityId: id, date, close: price, source: PriceSource.Manual },
        update: { close: price },
      }),
    ]);
    return security;
  }

  /**
   * Price a security by its institution, optionally following the market-priced fund whose daily
   * moves fill its days without an institution price (validated and created like any market
   * symbol); null follows nothing. Sets `priceSymbolOverride`, which pins the choice against
   * aggregator re-mapping. A security switched to market pricing can come back as long as
   * institution prices are stored for it: its market data is dropped as `setPriceSymbol` would,
   * and securities that followed it follow another market security for its old symbol instead.
   * Callers price `followed` and revalue under the refresh lock
   * (`InvestmentRefreshService.setProxy`).
   */
  async setProxy(id: string, symbol: string | null): Promise<ProxyChange> {
    const security = await this.prisma.security.findUnique({ where: { id } });
    if (!security) throw new InvestmentInputError('Security not found', 404);
    const wasInstitution = security.pricing === Pricing.Institution;
    if (!wasInstitution && !(await institutionPricedIds(this.prisma, [id])).has(id)) {
      throw new InvestmentInputError(
        'Only a fund priced by its institution can follow another fund'
      );
    }
    let proxy: Security | null = null;
    if (symbol != null) {
      proxy = (await this.findOrCreateMarket(symbol, { exclude: id })).security;
      if (proxy.id === id) throw new InvestmentInputError('A fund can’t follow itself');
      if (proxy.pricing !== Pricing.Market) {
        throw new InvestmentInputError(`${proxy.priceSymbol} has no market price to follow`);
      }
    }
    // Followers of a market security leaving its symbol keep following that symbol.
    const oldSymbol = wasInstitution ? null : security.priceSymbol;
    const repointed = oldSymbol
      ? (
          await this.prisma.security.findMany({
            where: { proxySecurityId: id },
            select: { id: true },
          })
        ).map((f) => f.id)
      : [];
    const replacement =
      oldSymbol && repointed.length
        ? (await this.findOrCreateMarket(oldSymbol, { exclude: id })).security
        : null;
    if (
      replacement &&
      (replacement.pricing !== Pricing.Market || repointed.includes(replacement.id))
    ) {
      throw new InvestmentInputError(
        `Funds following ${oldSymbol} have no other market price to follow`
      );
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: {
          pricing: Pricing.Institution,
          priceSymbol: null,
          priceSymbolOverride: true, // aggregator sync must not take the choice back
          pricesFetchedFrom: null,
          proxySecurityId: proxy?.id ?? null,
        },
      }),
      ...(wasInstitution ? [] : this.dropMarketData(id)),
      ...(replacement
        ? [
            this.prisma.security.updateMany({
              where: { id: { in: repointed } },
              data: { proxySecurityId: replacement.id },
            }),
          ]
        : []),
    ]);
    const followed = [
      ...new Set([proxy?.id, replacement?.id].filter((f): f is string => f != null)),
    ];
    return { security: updated, followed, repointed };
  }

  /** Deletes of a security's market-sourced closes and events, for a transaction. */
  private dropMarketData(id: string) {
    return [
      this.prisma.securityPrice.deleteMany({
        where: { securityId: id, source: PriceSource.Market },
      }),
      this.prisma.securityEvent.deleteMany({
        where: { securityId: id, source: PriceSource.Market },
      }),
    ];
  }

  private async requireSecurity(id: string): Promise<void> {
    if (!(await this.prisma.security.findUnique({ where: { id }, select: { id: true } }))) {
      throw new InvestmentInputError('Security not found', 404);
    }
  }
}
