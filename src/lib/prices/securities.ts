import type { PrismaClient, Security } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { utcDay } from '@/lib/investments/dates';
import { isValidCurrency } from '@/lib/currency';
import type { QuoteCache } from './quote-cache';
import type { SymbolLookup, SymbolMatch } from './types';
import { PriceSource, Pricing, SecurityType } from '@/lib/investments/codes';

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

  async findOrCreateMarket(symbol: string): Promise<{ security: Security; created: boolean }> {
    const priceSymbol = symbol.trim().toUpperCase();
    const existing = await this.prisma.security.findFirst({
      where: { priceSymbol },
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
      this.prisma.securityPrice.deleteMany({
        where: { securityId: id, source: PriceSource.Market },
      }),
      this.prisma.securityEvent.deleteMany({
        where: { securityId: id, source: PriceSource.Market },
      }),
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
   * Link an institution-priced security to the market-priced fund whose daily moves fill its days
   * without an institution price (validated and created like any market symbol); null unlinks.
   * Callers price the proxy and revalue under the refresh lock (`InvestmentRefreshService.setProxy`).
   */
  async setProxy(id: string, symbol: string | null): Promise<Security> {
    const security = await this.prisma.security.findUnique({ where: { id } });
    if (!security) throw new InvestmentInputError('Security not found', 404);
    if (security.pricing !== Pricing.Institution) {
      throw new InvestmentInputError(
        'Only a fund priced by its institution can follow another fund'
      );
    }
    if (symbol == null) {
      return this.prisma.security.update({ where: { id }, data: { proxySecurityId: null } });
    }
    const { security: proxy } = await this.findOrCreateMarket(symbol);
    if (proxy.id === id) throw new InvestmentInputError('A fund can’t follow itself');
    if (proxy.pricing !== Pricing.Market) {
      throw new InvestmentInputError(`${proxy.priceSymbol} has no market price to follow`);
    }
    return this.prisma.security.update({ where: { id }, data: { proxySecurityId: proxy.id } });
  }

  private async requireSecurity(id: string): Promise<void> {
    if (!(await this.prisma.security.findUnique({ where: { id }, select: { id: true } }))) {
      throw new InvestmentInputError('Security not found', 404);
    }
  }
}
