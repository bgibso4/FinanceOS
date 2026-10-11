export type PricePoint = { date: Date; close: number; source: string };
export type PricedAt = { price: number; estimated: boolean };

/** How one pricing mode prices a security on a UTC day (rules table in Plan 2, Task 3). */
export interface PricingStrategy {
  /** `points` are the security's stored prices, date ascending. */
  priceOn(points: PricePoint[], date: Date): PricedAt | null;
}

const fromSource = (points: PricePoint[], source: string) =>
  points.filter((p) => p.source === source);

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
}

export class PlaidPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return interpolate(fromSource(points, 'plaid'), date.getTime());
  }
}

export class FeedPricing implements PricingStrategy {
  private readonly fallback = new PlaidPricing();

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return (
      carryForward(fromSource(points, 'yahoo'), date.getTime(), false) ??
      this.fallback.priceOn(points, date)
    );
  }
}

export class ManualPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(fromSource(points, 'manual'), date.getTime(), false);
  }
}

export class UnpricedPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(points, date.getTime(), true);
  }
}

const STRATEGIES = new Map<string, (fixedPrice: number | null) => PricingStrategy>([
  ['fixed', (fixedPrice) => new FixedPricing(fixedPrice)],
  ['feed', () => new FeedPricing()],
  ['plaid', () => new PlaidPricing()],
  ['manual', () => new ManualPricing()],
  ['none', () => new UnpricedPricing()],
]);

/** The one place a `Security.pricing` value becomes behaviour. Unknown values price as unpriced. */
export function pricingFor(security: {
  pricing: string;
  fixedPrice: number | null;
}): PricingStrategy {
  const create = STRATEGIES.get(security.pricing);
  return create ? create(security.fixedPrice) : new UnpricedPricing();
}
