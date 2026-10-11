import type { PrismaClient, Security } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { utcDay } from '@/lib/investments/dates';
import type { QuoteCache } from './quote-cache';
import type { SymbolLookup, SymbolMatch } from './types';

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

  async findOrCreateFeed(symbol: string): Promise<{ security: Security; created: boolean }> {
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
        type: match?.type ?? 'other',
        currency: quote.currency,
        priceSymbol,
        priceSymbolOverride: true,
        pricing: 'feed',
      },
    });
    return { security, created: true };
  }

  /** Point a security at a new feed symbol (validated by a quote) and drop the old symbol's data. */
  async setPriceSymbol(id: string, symbol: string): Promise<Security> {
    await this.requireSecurity(id);
    const priceSymbol = symbol.trim().toUpperCase();
    await this.quotes.get(priceSymbol); // throws unknown_symbol → 400
    const [security] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: { priceSymbol, priceSymbolOverride: true, pricing: 'feed' },
      }),
      this.prisma.securityPrice.deleteMany({ where: { securityId: id, source: 'yahoo' } }),
      this.prisma.securityEvent.deleteMany({ where: { securityId: id, source: 'yahoo' } }),
    ]);
    return security;
  }

  /** Price a security by hand from today. Callers revalue (`valuation.writeBalances()`) after. */
  async setManualPrice(id: string, price: number): Promise<Security> {
    await this.requireSecurity(id);
    const date = utcDay(this.clock.now());
    const [security] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: { pricing: 'manual', priceSymbolOverride: true },
      }),
      this.prisma.securityPrice.upsert({
        where: { securityId_date_source: { securityId: id, date, source: 'manual' } },
        create: { securityId: id, date, close: price, source: 'manual' },
        update: { close: price },
      }),
    ]);
    return security;
  }

  private async requireSecurity(id: string): Promise<void> {
    if (!(await this.prisma.security.findUnique({ where: { id }, select: { id: true } }))) {
      throw new InvestmentInputError('Security not found', 404);
    }
  }
}
