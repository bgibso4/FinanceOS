/** The starting investing targets: created once, when there are no classes. */
export const DEFAULT_CLASSES = [
  { name: 'Stocks', pct: 80, splitByRegion: true },
  { name: 'Fixed income', pct: 15, splitByRegion: false },
  { name: 'Crypto', pct: 5, splitByRegion: false },
];

export const DEFAULT_REGIONS = [{ name: 'US' }, { name: 'Developed ex-US' }, { name: 'Emerging' }];

/** Market weights (percent); `region` names one of DEFAULT_REGIONS. */
export const DEFAULT_COUNTRIES = [
  { name: 'USA', weightPct: 55.9, region: 'US' },
  { name: 'Japan', weightPct: 7.4, region: 'Developed ex-US' },
  { name: 'UK', weightPct: 4.1, region: 'Developed ex-US' },
  { name: 'France', weightPct: 2.9, region: 'Developed ex-US' },
  { name: 'Switzerland', weightPct: 2.6, region: 'Developed ex-US' },
  { name: 'Germany', weightPct: 2.6, region: 'Developed ex-US' },
  { name: 'Australia', weightPct: 2.1, region: 'Developed ex-US' },
  { name: 'Other developed', weightPct: 2.77, region: 'Developed ex-US' },
  { name: 'Canada', weightPct: 3.55, region: 'Developed ex-US' },
  { name: 'China', weightPct: 5.4, region: 'Emerging' },
  { name: 'Taiwan', weightPct: 1.7, region: 'Emerging' },
  { name: 'Other emerging', weightPct: 8.32, region: 'Emerging' },
];
