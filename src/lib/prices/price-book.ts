import type { PrismaClient } from '@prisma/client';
import { parseExchangeRates } from '@/lib/currency';
import { pricingFor, type PricedAt, type PricePoint, type PricingStrategy } from './pricing';

type Entry = { strategy: PricingStrategy; points: PricePoint[] };

/** Prices for a set of securities, loaded once, answering "price of X on day D". */
export class PriceBook {
  private constructor(private readonly entries: Map<string, Entry>) {}

  static async load(prisma: PrismaClient, securityIds: string[], to: Date): Promise<PriceBook> {
    const ids = [...new Set(securityIds)];
    const [securities, rows] = await Promise.all([
      prisma.security.findMany({
        where: { id: { in: ids } },
        select: { id: true, pricing: true, fixedPrice: true },
      }),
      prisma.securityPrice.findMany({
        where: { securityId: { in: ids }, date: { lte: to } },
        orderBy: { date: 'asc' },
        select: { securityId: true, date: true, close: true, source: true },
      }),
    ]);
    const entries = new Map<string, Entry>(
      securities.map((s) => [s.id, { strategy: pricingFor(s), points: [] }])
    );
    for (const r of rows) entries.get(r.securityId)?.points.push(r);
    return new PriceBook(entries);
  }

  at(securityId: string, date: Date): PricedAt | null {
    const entry = this.entries.get(securityId);
    return entry ? entry.strategy.priceOn(entry.points, date) : null;
  }
}

export async function loadFxRates(prisma: PrismaClient): Promise<Map<string, number>> {
  return parseExchangeRates(await prisma.exchangeRate.findMany());
}
