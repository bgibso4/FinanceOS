// Pure, client-safe target math: no Prisma, no server imports.
import { roundCents } from '../money';

export type ClassInput = {
  id: string;
  name: string;
  pct: number;
  splitByRegion: boolean;
  buySecurityId: string | null;
};
export type RegionInput = {
  id: string;
  name: string;
  tiltPct: number;
  buySecurityId: string | null;
};
export type CountryInput = { weightPct: number; regionId: string };
export type TargetSetup = {
  classes: ClassInput[];
  regions: RegionInput[];
  countries: CountryInput[];
};

export type FinalTarget = {
  key: string;
  classId: string;
  regionId: string | null;
  name: string;
  className: string | null;
  buySecurityId: string | null;
  marketWeightPct: number | null;
  shareOfClass: number | null;
  target: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const targetKey = (classId: string, regionId: string | null) =>
  regionId === null ? classId : `${classId}:${regionId}`;

export function targetTotals(setup: TargetSetup): { countryWeightPct: number; classPct: number } {
  return {
    countryWeightPct: sum(setup.countries.map((c) => c.weightPct)),
    classPct: sum(setup.classes.map((c) => c.pct)),
  };
}

/** Flat list of final targets (fractions of the portfolio), classes in order, regions inside their class. */
export function finalTargets(setup: TargetSetup): FinalTarget[] {
  const { classPct } = targetTotals(setup);
  const regionWeight = (regionId: string) =>
    sum(setup.countries.filter((c) => c.regionId === regionId).map((c) => c.weightPct));
  const tilted = (r: RegionInput) => regionWeight(r.id) * (1 + r.tiltPct / 100);
  const tiltedTotal = sum(setup.regions.map(tilted));

  return setup.classes.flatMap((cls): FinalTarget[] => {
    const classFraction = classPct > 0 ? cls.pct / classPct : 0;
    if (!cls.splitByRegion) {
      return [
        {
          key: targetKey(cls.id, null),
          classId: cls.id,
          regionId: null,
          name: cls.name,
          className: null,
          buySecurityId: cls.buySecurityId,
          marketWeightPct: null,
          shareOfClass: null,
          target: classFraction,
        },
      ];
    }
    return setup.regions.map((r) => {
      const share = tiltedTotal > 0 ? tilted(r) / tiltedTotal : 0;
      return {
        key: targetKey(cls.id, r.id),
        classId: cls.id,
        regionId: r.id,
        name: r.name,
        className: cls.name,
        buySecurityId: r.buySecurityId,
        marketWeightPct: regionWeight(r.id),
        shareOfClass: share,
        target: classFraction * share,
      };
    });
  });
}

/**
 * Dollar trade per row key (positive buys, negative sells).
 * gap = target * (total + amount) - current. Sells off: fill positive gaps, split any extra by
 * target, or split the amount by gap if it is smaller. Rounded to cents; the remainder goes on the
 * trade with the largest absolute value so the trades add up to the amount.
 */
export function planTrades(
  rows: { key: string; current: number; target: number }[],
  amount: number,
  sells: boolean
): Record<string, number> {
  if (Math.abs(sum(rows.map((r) => r.target)) - 1) > 1e-6) {
    throw new RangeError('Targets must add up to 1');
  }
  const after = sum(rows.map((r) => r.current)) + amount;
  const gaps = rows.map((r) => r.target * after - r.current);

  let raw: number[];
  if (sells) {
    raw = gaps;
  } else {
    const buys = gaps.map((g) => Math.max(g, 0));
    const filled = sum(buys);
    raw =
      amount >= filled
        ? buys.map((b, i) => b + (amount - filled) * rows[i].target)
        : buys.map((b) => (b * amount) / filled);
  }

  const cents = raw.map(roundCents);
  if (cents.length > 0) {
    const largest = cents.reduce(
      (best, v, i) => (Math.abs(v) > Math.abs(cents[best]) ? i : best),
      0
    );
    cents[largest] = roundCents(cents[largest] + amount - sum(cents));
  }
  return Object.fromEntries(rows.map((r, i) => [r.key, cents[i]]));
}
