import { describe, it, expect } from 'vitest';
import { day } from '../../../helpers/investments';
import {
  InstitutionPricing,
  MarketPricing,
  pricingFor,
  ProxiedInstitutionPricing,
  UnpricedPricing,
  type PricePoint,
} from '@/lib/prices/pricing';
import { PriceSource, Pricing } from '@/lib/investments/codes';

const p = (date: string, close: number, source: string): PricePoint => ({
  date: day(date),
  close,
  source,
});

describe('pricing strategies', () => {
  const market = pricingFor({ pricing: Pricing.Market, fixedPrice: null });
  const institution = pricingFor({ pricing: Pricing.Institution, fixedPrice: null });

  it('picks the neutrally named strategy for each mode', () => {
    expect(market).toBeInstanceOf(MarketPricing);
    expect(institution).toBeInstanceOf(InstitutionPricing);
    expect(pricingFor({ pricing: Pricing.Institution, fixedPrice: null }, [])).toBeInstanceOf(
      ProxiedInstitutionPricing
    );
  });

  it('fixed pricing ignores points', () => {
    expect(
      pricingFor({ pricing: Pricing.Fixed, fixedPrice: null }).priceOn([], day('2026-10-01'))
    ).toEqual({ price: 1, estimated: false });
  });

  it('market pricing carries the latest close forward over weekends', () => {
    const pts = [p('2026-10-02', 10, PriceSource.Market)];
    expect(market.priceOn(pts, day('2026-10-04'))).toEqual({ price: 10, estimated: false });
  });

  it('market pricing falls back to institution prices before its first close', () => {
    const pts = [
      p('2026-09-01', 8, PriceSource.Institution),
      p('2026-10-02', 10, PriceSource.Market),
    ];
    expect(market.priceOn(pts, day('2026-09-15'))).toEqual({ price: 8, estimated: true });
  });

  it('institution pricing interpolates between reported prices', () => {
    const pts = [
      p('2026-10-01', 10, PriceSource.Institution),
      p('2026-10-11', 12, PriceSource.Institution),
    ];
    expect(institution.priceOn(pts, day('2026-10-06'))).toEqual({ price: 11, estimated: true });
    expect(institution.priceOn(pts, day('2026-10-11'))).toEqual({ price: 12, estimated: false });
    expect(institution.priceOn(pts, day('2026-10-20'))).toEqual({ price: 12, estimated: true });
    expect(institution.priceOn(pts, day('2026-09-30'))).toBeNull();
  });

  it('manual pricing carries the latest manual price', () => {
    const pts = [p('2026-10-01', 5, PriceSource.Manual), p('2026-10-03', 9, PriceSource.Market)];
    expect(
      pricingFor({ pricing: Pricing.Manual, fixedPrice: null }).priceOn(pts, day('2026-10-05'))
    ).toEqual({ price: 5, estimated: false });
  });

  it('unpriced securities use the latest known price, estimated', () => {
    const pts = [p('2026-10-01', 7, PriceSource.Institution)];
    expect(
      pricingFor({ pricing: Pricing.None, fixedPrice: null }).priceOn(pts, day('2026-10-05'))
    ).toEqual({ price: 7, estimated: true });
    expect(pricingFor({ pricing: 'something-new', fixedPrice: null })).toBeInstanceOf(
      UnpricedPricing
    );
  });

  describe('institution pricing with a proxy', () => {
    const proxy = [
      p('2026-09-01', 50, PriceSource.Market),
      p('2026-10-01', 100, PriceSource.Market),
      p('2026-10-05', 110, PriceSource.Market),
    ];
    const proxied = pricingFor({ pricing: Pricing.Institution, fixedPrice: null }, proxy);
    const pts = [
      p('2026-10-01', 20, PriceSource.Institution),
      p('2026-10-11', 25, PriceSource.Institution),
    ];

    it('uses an institution price on its own day', () => {
      expect(proxied.priceOn(pts, day('2026-10-11'))).toEqual({ price: 25, estimated: false });
    });

    it('moves the latest earlier institution price by the proxy since then', () => {
      // 20 × 110 / 100
      expect(proxied.priceOn(pts, day('2026-10-06'))).toEqual({ price: 22, estimated: true });
    });

    it('moves the first institution price back by the proxy before it', () => {
      // 20 × 50 / 100 (the proxy's Sep 1 close carried to Sep 15)
      expect(proxied.priceOn(pts, day('2026-09-15'))).toEqual({ price: 10, estimated: true });
    });

    it("falls back to institution pricing before the proxy's first close", () => {
      expect(proxied.priceOn(pts, day('2026-08-01'))).toBeNull();
    });

    it('falls back to institution interpolation when the proxy has no closes', () => {
      const bare = pricingFor({ pricing: Pricing.Institution, fixedPrice: null }, []);
      expect(bare.priceOn(pts, day('2026-10-06'))).toEqual({ price: 22.5, estimated: true });
    });

    it('falls back to institution pricing when the proxy closed at zero on the anchor day', () => {
      const zeroed = pricingFor({ pricing: Pricing.Institution, fixedPrice: null }, [
        p('2026-10-01', 0, PriceSource.Market),
        p('2026-10-05', 110, PriceSource.Market),
      ]);
      expect(zeroed.priceOn(pts, day('2026-10-06'))).toEqual({ price: 22.5, estimated: true });
    });

    it('ignores a proxy on any other pricing mode', () => {
      const marketWithProxy = pricingFor({ pricing: Pricing.Market, fixedPrice: null }, proxy);
      const closes = [p('2026-10-02', 10, PriceSource.Market)];
      expect(marketWithProxy.priceOn(closes, day('2026-10-04'))).toEqual({
        price: 10,
        estimated: false,
      });
    });
  });
});

describe('latest price per mode', () => {
  const pts = [
    p('2026-10-01', 10, PriceSource.Market),
    p('2026-10-02', 20, PriceSource.Institution),
    p('2026-10-03', 30, PriceSource.Manual),
    p('2026-10-04', 11, PriceSource.Market),
    p('2026-10-05', 21, PriceSource.Institution),
  ];
  const latest = (pricing: string, fixedPrice: number | null = null, proxy?: PricePoint[]) =>
    pricingFor({ pricing, fixedPrice }, proxy).latest(pts);

  it('reads only the mode’s own source', () => {
    expect(latest(Pricing.Market)).toEqual({ price: 11, date: day('2026-10-04') });
    expect(latest(Pricing.Institution)).toEqual({ price: 21, date: day('2026-10-05') });
    expect(latest(Pricing.Institution, null, [p('2026-10-06', 50, PriceSource.Market)])).toEqual({
      price: 21,
      date: day('2026-10-05'),
    });
    expect(latest(Pricing.Manual)).toEqual({ price: 30, date: day('2026-10-03') });
  });

  it('gives a fixed price with no date, and nothing for unpriced or missing sources', () => {
    expect(latest(Pricing.Fixed, 2.5)).toEqual({ price: 2.5, date: null });
    expect(latest(Pricing.Fixed)).toEqual({ price: 1, date: null });
    expect(latest(Pricing.None)).toBeNull();
    expect(
      pricingFor({ pricing: Pricing.Market, fixedPrice: null }).latest([
        p('2026-10-02', 20, PriceSource.Institution),
      ])
    ).toBeNull();
  });
});
