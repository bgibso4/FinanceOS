import { describe, it, expect } from 'vitest';
import {
  filterSecurities,
  heldInText,
  latestView,
  nameLine,
  priceSourceView,
  SECURITY_FILTERS,
  securitySettingsHref,
  typeLabel,
} from '@/components/investments/securities-view';
import { Pricing, SecurityType } from '@/lib/investments/codes';
import { makeSecurityItem } from '../../../helpers/investment-overview';

describe('priceSourceView', () => {
  it.each([
    [
      'market',
      makeSecurityItem(),
      { name: 'Market · AAA', main: 'Market · AAA', detail: null, warn: false },
    ],
    [
      'institution following a fund',
      makeSecurityItem({ pricing: Pricing.Institution, priceSymbol: null, proxySymbol: 'PRXY' }),
      {
        name: 'Institution · follows PRXY',
        main: 'Institution · follows PRXY',
        detail: null,
        warn: false,
      },
    ],
    [
      'institution alone',
      makeSecurityItem({ pricing: Pricing.Institution, priceSymbol: null }),
      { name: 'Institution', main: 'Institution', detail: null, warn: false },
    ],
    [
      'manual',
      makeSecurityItem({ pricing: Pricing.Manual, latest: { price: 64.3, date: '2026-09-30' } }),
      { name: 'Manual', main: 'Manual · $64.30', detail: 'Entered Sep 30', warn: false },
    ],
    [
      'fixed',
      makeSecurityItem({
        pricing: Pricing.Fixed,
        currency: 'CAD',
        fixedPrice: 1,
        latest: { price: 1, date: null },
      }),
      { name: 'Fixed', main: 'Fixed · CA$1.00', detail: null, warn: false },
    ],
    [
      'none',
      makeSecurityItem({ pricing: Pricing.None, latest: null }),
      {
        name: 'No price source',
        main: 'No price source',
        detail: 'Valued at its last known price',
        warn: true,
      },
    ],
  ])('labels %s', (_name, item, view) => {
    expect(priceSourceView(item)).toEqual(view);
  });

  it('falls back when the data behind a label is missing', () => {
    expect(priceSourceView(makeSecurityItem({ priceSymbol: null })).main).toBe('Market');
    expect(priceSourceView(makeSecurityItem({ pricing: Pricing.Manual, latest: null }))).toEqual({
      name: 'Manual',
      main: 'Manual',
      detail: null,
      warn: false,
    });
    const unknown = makeSecurityItem({ pricing: 'something-new' as Pricing });
    expect(priceSourceView(unknown).main).toBe('No price source');
  });
});

describe('latestView', () => {
  it('formats the price in the security’s currency, with a UTC day', () => {
    expect(latestView(makeSecurityItem({ currency: 'CAD' }))).toEqual({
      price: 'CA$110.00',
      date: 'Oct 8',
    });
    expect(latestView(makeSecurityItem({ latest: { price: 1, date: null } }))).toEqual({
      price: '$1.00',
      date: null,
    });
    expect(latestView(makeSecurityItem({ latest: null }))).toBeNull();
  });
});

describe('securitySettingsHref', () => {
  it('deep-links the securities tab to one security', () => {
    expect(securitySettingsHref('sec-z')).toBe('/settings?tab=securities&security=sec-z');
  });
});

describe('typeLabel and heldInText', () => {
  it('names every security type', () => {
    expect(Object.values(SecurityType).map(typeLabel)).toEqual([
      'ETF',
      'Stock',
      'Fund',
      'Money market',
      'Cash',
      'Crypto',
      'Other',
    ]);
    expect(typeLabel('warrant' as SecurityType)).toBe('Other');
  });

  it('counts accounts, or says the security is not held', () => {
    expect([0, 1, 3].map(heldInText)).toEqual(['Not held', '1 account', '3 accounts']);
  });
});

describe('filterSecurities', () => {
  const items = [
    makeSecurityItem({ id: 'a', label: 'AAA', name: 'Triple A Fund' }),
    makeSecurityItem({ id: 'p', label: 'PLAN', name: 'Example Plan Trust', pricing: Pricing.None }),
  ];
  const ids = (filter: 'all' | 'attention', q = '') =>
    filterSecurities(items, filter, q).map((s) => s.id);

  it('keeps securities with no price source under Needs attention', () => {
    expect(SECURITY_FILTERS.map((f) => f.label)).toEqual(['All', 'Needs attention']);
    expect(ids('all')).toEqual(['a', 'p']);
    expect(ids('attention')).toEqual(['p']);
  });

  it('counts and keeps an unknown pricing value under Needs attention, as its row warns', () => {
    const odd = makeSecurityItem({ id: 'u', pricing: 'something-new' as Pricing });
    const attention = SECURITY_FILTERS.find((f) => f.id === 'attention')!;
    expect(attention.keeps(odd)).toBe(true);
    expect(filterSecurities([odd], 'attention', '').map((s) => s.id)).toEqual(['u']);
  });

  it('searches ticker or name, ignoring case and surrounding spaces', () => {
    expect(ids('all', '  trust ')).toEqual(['p']);
    expect(ids('all', 'aaa')).toEqual(['a']);
    expect(ids('attention', 'aaa')).toEqual([]);
  });
});

describe('nameLine', () => {
  it('shows a name that differs from the label', () => {
    expect(nameLine(makeSecurityItem({ label: 'AAA', name: 'Triple A Fund' }))).toBe(
      'Triple A Fund'
    );
  });

  it('hides a name that repeats the label, and any cash name', () => {
    expect(nameLine(makeSecurityItem({ label: 'AAA', name: 'AAA' }))).toBeNull();
    expect(
      nameLine(
        makeSecurityItem({ label: 'CAD cash', name: 'Canadian Dollar', type: SecurityType.Cash })
      )
    ).toBeNull();
  });
});
