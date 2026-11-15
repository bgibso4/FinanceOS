import { describe, it, expect } from 'vitest';
import {
  finalTargets,
  planTrades,
  targetKey,
  targetTotals,
  type TargetSetup,
} from '@/lib/investments/targets/allocation';

const country = (weightPct: number, regionId: string) => ({ weightPct, regionId });

const startingSetup = (over: Partial<TargetSetup> = {}): TargetSetup => ({
  classes: [
    { id: 'stocks', name: 'Stocks', pct: 80, splitByRegion: true, buySecurityId: null },
    { id: 'fi', name: 'Fixed income', pct: 15, splitByRegion: false, buySecurityId: null },
    { id: 'crypto', name: 'Crypto', pct: 5, splitByRegion: false, buySecurityId: null },
  ],
  regions: [
    { id: 'us', name: 'US', tiltPct: 0, buySecurityId: null },
    { id: 'dev', name: 'Developed ex-US', tiltPct: 0, buySecurityId: null },
    { id: 'em', name: 'Emerging', tiltPct: 0, buySecurityId: null },
  ],
  countries: [
    country(55.9, 'us'),
    ...[7.4, 4.1, 2.9, 2.6, 2.6, 2.1, 2.77, 3.55].map((w) => country(w, 'dev')),
    ...[5.4, 1.7, 8.32].map((w) => country(w, 'em')),
  ],
  ...over,
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('finalTargets', () => {
  it('starting setup gives the acceptance targets', () => {
    const t = finalTargets(startingSetup());
    expect(t.map((x) => x.key)).toEqual(['stocks:us', 'stocks:dev', 'stocks:em', 'fi', 'crypto']);
    [0.4502, 0.2256, 0.1242, 0.15, 0.05].forEach((v, i) => expect(t[i].target).toBeCloseTo(v, 4));
    expect(t[0].shareOfClass).toBeCloseTo(0.5627, 4);
    expect(t[0]).toMatchObject({ name: 'US', className: 'Stocks', regionId: 'us' });
    expect(t[0].marketWeightPct).toBeCloseTo(55.9, 6);
    expect(t[3]).toMatchObject({
      name: 'Fixed income',
      className: null,
      regionId: null,
      marketWeightPct: null,
      shareOfClass: null,
    });
    expect(sum(t.map((x) => x.target))).toBeCloseTo(1, 9);
  });

  it('tilt then scale within the class', () => {
    const s = startingSetup();
    s.regions[0].tiltPct = 20;
    const t = finalTargets(s);
    expect(t[0].shareOfClass).toBeCloseTo(0.6069, 4);
  });

  it('class percentages scale', () => {
    const s: TargetSetup = {
      classes: [
        { id: 'a', name: 'A', pct: 40, splitByRegion: false, buySecurityId: null },
        { id: 'b', name: 'B', pct: 40, splitByRegion: false, buySecurityId: null },
      ],
      regions: [],
      countries: [],
    };
    expect(finalTargets(s).map((x) => x.target)).toEqual([0.5, 0.5]);
    expect(targetTotals(s)).toEqual({ countryWeightPct: 0, classPct: 80 });
  });

  it('a class at 0 has target 0 and the rest still add to 1', () => {
    const s = startingSetup();
    s.classes[2].pct = 0;
    const t = finalTargets(s);
    expect(t[4].target).toBe(0);
    expect(sum(t.map((x) => x.target))).toBeCloseTo(1, 9);
  });

  it('a split class with no country weight gives its regions 0', () => {
    const t = finalTargets(startingSetup({ countries: [] }));
    expect(t.slice(0, 3).map((x) => x.target)).toEqual([0, 0, 0]);
  });

  it('a zero class sum gives every target 0', () => {
    const s = startingSetup();
    s.classes.forEach((c) => (c.pct = 0));
    expect(finalTargets(s).every((x) => x.target === 0)).toBe(true);
  });

  it('targetKey joins class and region', () => {
    expect(targetKey('c', null)).toBe('c');
    expect(targetKey('c', 'r')).toBe('c:r');
  });
});

describe('planTrades', () => {
  const rows = (cur: number[], tgt: number[]) =>
    cur.map((current, i) => ({ key: `k${i}`, current, target: tgt[i] }));
  const values = (r: Record<string, number>) => Object.keys(r).map((k) => r[k]);

  it('worked example', () => {
    const r = planTrades(rows([4700, 2000, 1300], [0.6, 0.25, 0.15]), 1000, false);
    expect(values(r)).toEqual([700, 250, 50]);
  });

  it('an overweight target leaves the rest to share by gap', () => {
    const r = planTrades(rows([0, 1000, 0], [0.4, 0.4, 0.2]), 500, false);
    expect(values(r)).toEqual([333.33, 0, 166.67]);
  });

  it('no overweight fills every gap exactly', () => {
    const r = planTrades(rows([100, 0], [0.5, 0.5]), 300, false);
    expect(values(r)).toEqual([100, 200]);
  });

  it('overweight gets 0 with sells off, and no trade is negative', () => {
    const r = planTrades(rows([900, 100], [0.5, 0.5]), 100, false);
    expect(r.k0).toBe(0);
    expect(values(r).every((v) => v >= 0)).toBe(true);
  });

  it('sells on lands on target', () => {
    const r = planTrades(rows([900, 100], [0.5, 0.5]), 0, true);
    expect(values(r)).toEqual([-400, 400]);
  });

  it('buys add up to the amount', () => {
    const r = planTrades(rows([0, 0, 0], [1 / 3, 1 / 3, 1 / 3]), 1000.01, false);
    expect(Math.round(sum(values(r)) * 100)).toBe(100001);
    expect(values(r).sort()).toEqual([333.33, 333.34, 333.34]);
  });

  it('empty portfolio splits by target', () => {
    const r = planTrades(rows([0, 0], [0.75, 0.25]), 1000, false);
    expect(values(r)).toEqual([750, 250]);
  });

  it('targets not adding to 1 throw', () => {
    expect(() => planTrades(rows([0, 0], [0.5, 0.4]), 100, false)).toThrow(RangeError);
  });
});
