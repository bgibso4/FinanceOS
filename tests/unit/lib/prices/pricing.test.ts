import { describe, it, expect } from 'vitest';
import { day } from '../../../helpers/investments';
import { pricingFor, UnpricedPricing, type PricePoint } from '@/lib/prices/pricing';

const p = (date: string, close: number, source: string): PricePoint => ({
  date: day(date),
  close,
  source,
});

describe('pricing strategies', () => {
  const feed = pricingFor({ pricing: 'feed', fixedPrice: null });
  const plaid = pricingFor({ pricing: 'plaid', fixedPrice: null });

  it('fixed pricing ignores points', () => {
    expect(
      pricingFor({ pricing: 'fixed', fixedPrice: null }).priceOn([], day('2026-10-01'))
    ).toEqual({ price: 1, estimated: false });
  });

  it('feed carries the latest close forward over weekends', () => {
    const pts = [p('2026-10-02', 10, 'yahoo')];
    expect(feed.priceOn(pts, day('2026-10-04'))).toEqual({ price: 10, estimated: false });
  });

  it('feed falls back to Plaid prices before its first close', () => {
    const pts = [p('2026-09-01', 8, 'plaid'), p('2026-10-02', 10, 'yahoo')];
    expect(feed.priceOn(pts, day('2026-09-15'))).toEqual({ price: 8, estimated: true });
  });

  it('plaid pricing interpolates between reported prices', () => {
    const pts = [p('2026-10-01', 10, 'plaid'), p('2026-10-11', 12, 'plaid')];
    expect(plaid.priceOn(pts, day('2026-10-06'))).toEqual({ price: 11, estimated: true });
    expect(plaid.priceOn(pts, day('2026-10-11'))).toEqual({ price: 12, estimated: false });
    expect(plaid.priceOn(pts, day('2026-10-20'))).toEqual({ price: 12, estimated: true });
    expect(plaid.priceOn(pts, day('2026-09-30'))).toBeNull();
  });

  it('manual pricing carries the latest manual price', () => {
    const pts = [p('2026-10-01', 5, 'manual'), p('2026-10-03', 9, 'yahoo')];
    expect(
      pricingFor({ pricing: 'manual', fixedPrice: null }).priceOn(pts, day('2026-10-05'))
    ).toEqual({ price: 5, estimated: false });
  });

  it('unpriced securities use the latest known price, estimated', () => {
    const pts = [p('2026-10-01', 7, 'plaid')];
    expect(
      pricingFor({ pricing: 'none', fixedPrice: null }).priceOn(pts, day('2026-10-05'))
    ).toEqual({ price: 7, estimated: true });
    expect(pricingFor({ pricing: 'something-new', fixedPrice: null })).toBeInstanceOf(
      UnpricedPricing
    );
  });
});
