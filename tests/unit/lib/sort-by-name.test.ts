import { describe, it, expect } from 'vitest';
import { byName, nameSortKey } from '@/lib/sort-by-name';

const sorted = (names: string[]) =>
  names
    .map((name) => ({ name }))
    .sort(byName)
    .map((n) => n.name);

describe('byName', () => {
  it('ignoresLeadingEmoji', () => {
    expect(sorted(['🛒 Groceries', '⛽️ Gas', 'Bills', '🏌️‍♂️Other Golf', '❗️Stuff'])).toEqual([
      'Bills',
      '⛽️ Gas',
      '🛒 Groceries',
      '🏌️‍♂️Other Golf',
      '❗️Stuff',
    ]);
  });

  it('caseAndNumbers', () => {
    expect(sorted(['b', 'A', 'Item 10', 'Item 2'])).toEqual(['A', 'b', 'Item 2', 'Item 10']);
  });

  it('keyDropsLeadingSymbolsOnly', () => {
    expect(nameSortKey('🏌️‍♂️Other Golf')).toBe('Other Golf');
    expect(nameSortKey('  ⛽️ Gas ')).toBe('Gas');
    expect(nameSortKey('A 🛒')).toBe('A 🛒');
  });
});
