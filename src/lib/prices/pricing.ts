import { PriceSource, Pricing } from '@/lib/investments/codes';
export type PricePoint = { date: Date; close: number; source: string };
export type PricedAt = { price: number; estimated: boolean };
/** The newest price a pricing mode reads from its own source; `date` is null for a constant. */
export type LatestPrice = { price: number; date: Date | null };

/** How one pricing mode prices a security on a UTC day (rules table in Plan 2, Task 3). */
export interface PricingStrategy {
  /** `points` are the security's stored prices, date ascending. */
  priceOn(points: PricePoint[], date: Date): PricedAt | null;
  /** The newest of `points` this mode reads (Settings → Securities); null when none. */
  latest(points: PricePoint[]): LatestPrice | null;
}

const fromSource = (points: PricePoint[], source: string) =>
  points.filter((p) => p.source === source);

function lastFrom(points: PricePoint[], source: string): LatestPrice | null {
  const last = fromSource(points, source).at(-1);
  return last ? { price: last.close, date: last.date } : null;
}

function carryForward(points: PricePoint[], t: number, estimated: boolean): PricedAt | null {
  let found: PricePoint | null = null;
  for (const p of points) {
    if (p.date.getTime() > t) break;
    found = p;
  }
  return found ? { price: found.close, estimated } : null;
}

function interpolate(points: PricePoint[], t: number): PricedAt | null {
  let before: PricePoint | null = null;
  let after: PricePoint | null = null;
  for (const p of points) {
    if (p.date.getTime() <= t) before = p;
    else {
      after = p;
      break;
    }
  }
  if (!before) return null;
  if (before.date.getTime() === t) return { price: before.close, estimated: false };
  if (!after) return { price: before.close, estimated: true };
  const span = after.date.getTime() - before.date.getTime();
  const f = (t - before.date.getTime()) / span;
  return { price: before.close + f * (after.close - before.close), estimated: true };
}

export class FixedPricing implements PricingStrategy {
  constructor(private readonly fixedPrice: number | null) {}

  priceOn(): PricedAt {
    return { price: this.fixedPrice ?? 1, estimated: false };
  }

  latest(): LatestPrice {
    return { price: this.priceOn().price, date: null };
  }
}

/** The prices the institution reports with each sync, interpolated between them. */
export class InstitutionPricing implements PricingStrategy {
  latest(points: PricePoint[]): LatestPrice | null {
    return lastFrom(points, PriceSource.Institution);
  }

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return interpolate(fromSource(points, PriceSource.Institution), date.getTime());
  }
}

/**
 * Institution prices, with every other day moved by a proxy fund's closes (spec §6.2): the latest
 * institution price on or before the day (else the first one after) × proxy(day) / proxy(that
 * price's day). Without proxy closes for both days, plain institution pricing.
 */
export class ProxiedInstitutionPricing implements PricingStrategy {
  private readonly fallback = new InstitutionPricing();

  constructor(private readonly proxyPoints: PricePoint[]) {}

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    const t = date.getTime();
    const reported = fromSource(points, PriceSource.Institution);
    const anchor = reported.filter((p) => p.date.getTime() <= t).at(-1) ?? reported[0];
    if (anchor?.date.getTime() === t) return { price: anchor.close, estimated: false };
    const proxy = fromSource(this.proxyPoints, PriceSource.Market);
    const now = carryForward(proxy, t, true);
    const then = anchor ? carryForward(proxy, anchor.date.getTime(), true) : null;
    // A zero close can't scale the anchor; institution pricing answers instead.
    if (anchor && now && then && then.price > 0) {
      return { price: (anchor.close * now.price) / then.price, estimated: true };
    }
    return this.fallback.priceOn(points, date);
  }

  latest(points: PricePoint[]): LatestPrice | null {
    return this.fallback.latest(points);
  }
}

/** Market closes carried forward; institution prices before the first close. */
export class MarketPricing implements PricingStrategy {
  private readonly fallback = new InstitutionPricing();

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return (
      carryForward(fromSource(points, PriceSource.Market), date.getTime(), false) ??
      this.fallback.priceOn(points, date)
    );
  }

  latest(points: PricePoint[]): LatestPrice | null {
    return lastFrom(points, PriceSource.Market);
  }
}

export class ManualPricing implements PricingStrategy {
  latest(points: PricePoint[]): LatestPrice | null {
    return lastFrom(points, PriceSource.Manual);
  }

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(fromSource(points, PriceSource.Manual), date.getTime(), false);
  }
}

export class UnpricedPricing implements PricingStrategy {
  latest(): null {
    return null;
  }

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(points, date.getTime(), true);
  }
}

const STRATEGIES = new Map<string, (fixedPrice: number | null) => PricingStrategy>([
  [Pricing.Fixed, (fixedPrice) => new FixedPricing(fixedPrice)],
  [Pricing.Market, () => new MarketPricing()],
  [Pricing.Institution, () => new InstitutionPricing()],
  [Pricing.Manual, () => new ManualPricing()],
  [Pricing.None, () => new UnpricedPricing()],
]);

/**
 * The one place a `Security.pricing` value becomes behaviour. Unknown values price as unpriced.
 * `proxyPoints` (the proxy's stored prices) apply only to institution pricing.
 */
export function pricingFor(
  security: { pricing: string; fixedPrice: number | null },
  proxyPoints?: PricePoint[]
): PricingStrategy {
  if (security.pricing === Pricing.Institution && proxyPoints)
    return new ProxiedInstitutionPricing(proxyPoints);
  const create = STRATEGIES.get(security.pricing);
  return create ? create(security.fixedPrice) : new UnpricedPricing();
}
