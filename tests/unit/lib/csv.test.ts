import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('quotedCommaStaysOneField', () => {
    expect(parseCsv('a,"b, c",d')).toEqual([['a', 'b, c', 'd']]);
  });

  it('doubledQuoteIsOneQuote', () => {
    expect(parseCsv('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it('crlfAndLfBothSplitRows', () => {
    expect(parseCsv('a,b\r\nc,d\ne,f')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('blankLineIsKept', () => {
    expect(parseCsv('h\n\nx')).toEqual([['h'], [''], ['x']]);
  });

  it('keepsNewlineInsideQuotesAndDoesNotTrim', () => {
    expect(parseCsv('" a ","b\nc"\n')).toEqual([[' a ', 'b\nc']]);
  });

  it('leadingBomIsStripped', () => {
    expect(parseCsv('\uFEFFDate,Cost\n2026-01-01,5')).toEqual([
      ['Date', 'Cost'],
      ['2026-01-01', '5'],
    ]);
  });

  it('unterminatedQuoteThrowsNamingTheRow', () => {
    expect(() => parseCsv('a,b\nc,"d, e\nf,g')).toThrow(
      'Row 2 has a quoted field that is never closed.'
    );
  });
});
