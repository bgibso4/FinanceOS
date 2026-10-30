import type { PrismaClient } from '@prisma/client';
import { parseExchangeRates } from '@/lib/currency';
import { PriceSource } from '@/lib/investments/codes';
import {
  pricingFor,
  type LatestPrice,
  type PricedAt,
  type PricePoint,
  type PricingStrategy,
} from './pricing';

type Entry = { strategy: PricingStrategy; points: PricePoint[] };

/** Prices for a set of securities, loaded once, answering "price of X on day D". */
export class PriceBook {
  private constructor(private readonly entries: Map<string, Entry>) {}

  static async load(prisma: PrismaClient, securityIds: string[], to: Date): Promise<PriceBook> {
    const ids = [...new Set(securityIds)];
    const securities = await prisma.security.findMany({
      where: { id: { in: ids } },
      select: { id: true, pricing: true, fixedPrice: true, proxySecurityId: true },
    });
    const proxyIds = securities.flatMap((s) => (s.proxySecurityId ? [s.proxySecurityId] : []));
    const rows = await prisma.securityPrice.findMany({
      where: { securityId: { in: [...ids, ...proxyIds] }, date: { lte: to } },
      orderBy: { date: 'asc' },
      select: { securityId: true, date: true, close: true, source: true },
    });
    const pointsOf = new Map<string, PricePoint[]>();
    for (const r of rows) {
      const list = pointsOf.get(r.securityId);
      if (list) list.push(r);
      else pointsOf.set(r.securityId, [r]);
    }
    const entries = new Map<string, Entry>(
      securities.map((s) => [
        s.id,
        {
          strategy: pricingFor(
            s,
            s.proxySecurityId ? (pointsOf.get(s.proxySecurityId) ?? []) : undefined
          ),
          points: pointsOf.get(s.id) ?? [],
        },
      ])
    );
    return new PriceBook(entries);
  }

  at(securityId: string, date: Date): PricedAt | null {
    const entry = this.entries.get(securityId);
    return entry ? entry.strategy.priceOn(entry.points, date) : null;
  }

  /** The newest price the security's own pricing mode stored; null when unknown or none. */
  latest(securityId: string): LatestPrice | null {
    const entry = this.entries.get(securityId);
    return entry ? entry.strategy.latest(entry.points) : null;
  }
}

export async function loadFxRates(prisma: PrismaClient): Promise<Map<string, number>> {
  return parseExchangeRates(await prisma.exchangeRate.findMany());
}

/** Which of `securityIds` have a stored institution price (Institution pricing is offered). */
export async function institutionPricedIds(
  prisma: PrismaClient,
  securityIds: string[]
): Promise<Set<string>> {
  const rows = await prisma.securityPrice.findMany({
    where: { securityId: { in: securityIds }, source: PriceSource.Institution },
    distinct: ['securityId'],
    select: { securityId: true },
  });
  return new Set(rows.map((r) => r.securityId));
}
