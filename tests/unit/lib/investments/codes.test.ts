import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  BalanceRowSource,
  BalanceSource,
  LEGACY_CODES,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from '@/lib/investments/codes';

const FAMILIES: [string, Record<string, string>][] = [
  ['Pricing', Pricing],
  ['PriceSource', PriceSource],
  ['RecordSource', RecordSource],
  ['BalanceRowSource', BalanceRowSource],
  ['BalanceSource', BalanceSource],
  ['SecurityType', SecurityType],
];

describe('stored codes', () => {
  it.each(FAMILIES)('%s round-trips its zod enum', (_name, codes) => {
    const schema = z.enum(codes);
    const values = Object.values(codes);
    expect(values.map((v) => schema.parse(v))).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
    expect(schema.safeParse('unknown-code').success).toBe(false);
  });

  it('stores neutral values, and maps every old value onto a current one of its family', () => {
    expect([
      Pricing.Market,
      Pricing.Institution,
      PriceSource.Market,
      PriceSource.Institution,
      RecordSource.Synced,
      BalanceRowSource.Synced,
    ]).toEqual(['market', 'institution', 'market', 'institution', 'synced', 'synced']);
    const families: Record<keyof typeof LEGACY_CODES, Record<string, string>> = {
      pricing: Pricing,
      priceSource: PriceSource,
      recordSource: RecordSource,
      balanceRowSource: BalanceRowSource,
    };
    for (const [family, legacy] of Object.entries(LEGACY_CODES)) {
      const current = Object.values(families[family as keyof typeof LEGACY_CODES]);
      for (const [old, now] of Object.entries(legacy)) {
        expect(current).toContain(now);
        expect(current).not.toContain(old);
      }
    }
  });

  it('pins the full value set of every family, so renaming any member fails', () => {
    expect(Object.values(Pricing)).toEqual(['market', 'institution', 'fixed', 'manual', 'none']);
    expect(Object.values(PriceSource)).toEqual(['market', 'institution', 'manual']);
    expect(Object.values(RecordSource)).toEqual(['synced', 'manual', 'import']);
    expect(Object.values(BalanceRowSource)).toEqual(['synced', 'valuation', 'manual']);
    expect(Object.values(BalanceSource)).toEqual(['provider', 'valuation', 'manual']);
    expect(Object.values(SecurityType)).toEqual([
      'etf',
      'equity',
      'mutual_fund',
      'money_market',
      'cash',
      'crypto',
      'other',
    ]);
  });
});
