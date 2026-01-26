import { describe, it, expect } from 'vitest';
import { isMerchantSimilar } from '@/lib/sync-common';

describe('sync-common', () => {
  describe('isMerchantSimilar', () => {
    describe('exact matches', () => {
      it('matches identical strings', () => {
        expect(isMerchantSimilar('chase', 'chase')).toBe(true);
        expect(isMerchantSimilar('amazon', 'amazon')).toBe(true);
      });

      it('matches case-insensitively', () => {
        expect(isMerchantSimilar('CHASE', 'chase')).toBe(true);
        expect(isMerchantSimilar('Amazon', 'AMAZON')).toBe(true);
        expect(isMerchantSimilar('WalMart', 'walmart')).toBe(true);
      });

      it('handles whitespace variations', () => {
        expect(isMerchantSimilar('chase ', ' chase')).toBe(true);
        expect(isMerchantSimilar('  amazon  ', 'amazon')).toBe(true);
      });
    });

    describe('substring matches', () => {
      it('matches when one contains the other', () => {
        expect(isMerchantSimilar('chase travel', 'chase')).toBe(true);
        expect(isMerchantSimilar('chase', 'chase travel')).toBe(true);
        expect(isMerchantSimilar('walmart supercenter', 'walmart')).toBe(true);
      });

      it('matches partial word containment', () => {
        expect(isMerchantSimilar('starbucks coffee', 'starbucks')).toBe(true);
        expect(isMerchantSimilar('amazon prime', 'amazon')).toBe(true);
      });
    });

    describe('word overlap matches', () => {
      it('matches when any significant word overlaps', () => {
        expect(isMerchantSimilar('chase travel', 'chase bank')).toBe(true);
        expect(isMerchantSimilar('uber trip', 'uber eats')).toBe(true);
        expect(isMerchantSimilar('target store', 'target online')).toBe(true);
      });

      it('ignores short words (length <= 2)', () => {
        // "to" is too short to be significant
        expect(isMerchantSimilar('way to go', 'way home')).toBe(true); // "way" matches
      });

      it('matches words contained within other words', () => {
        expect(isMerchantSimilar('walmart', 'walmart supercenter')).toBe(true);
        expect(isMerchantSimilar('star', 'starbucks')).toBe(true);
      });
    });

    describe('real-world merchant matching scenarios', () => {
      it('matches Chase credit card variations', () => {
        expect(isMerchantSimilar('chase travel', 'chase')).toBe(true);
        expect(isMerchantSimilar('chase', 'chase travel')).toBe(true);
        expect(isMerchantSimilar('chase bank', 'chase credit')).toBe(true);
      });

      it('matches common retailer variations', () => {
        expect(isMerchantSimilar('amazon com', 'amazon')).toBe(true);
        expect(isMerchantSimilar('amzn mktp', 'amazon')).toBe(false); // Different abbreviation
        expect(isMerchantSimilar('wal mart', 'walmart')).toBe(true);
        expect(isMerchantSimilar('target', 'target store')).toBe(true);
      });

      it('matches subscription service variations', () => {
        expect(isMerchantSimilar('netflix com', 'netflix')).toBe(true);
        expect(isMerchantSimilar('spotify usa', 'spotify')).toBe(true);
        expect(isMerchantSimilar('apple com', 'apple')).toBe(true);
      });

      it('matches rideshare variations', () => {
        expect(isMerchantSimilar('uber trip', 'uber')).toBe(true);
        expect(isMerchantSimilar('lyft ride', 'lyft')).toBe(true);
        expect(isMerchantSimilar('doordash chipotle', 'doordash')).toBe(true);
      });

      it('handles bank transfer descriptions', () => {
        expect(isMerchantSimilar('payment from', 'payment')).toBe(true);
        expect(isMerchantSimilar('customer transfer', 'transfer')).toBe(true);
        expect(isMerchantSimilar('online transfer', 'transfer')).toBe(true);
      });
    });

    describe('non-matches', () => {
      it('does not match completely different merchants', () => {
        expect(isMerchantSimilar('chase', 'walmart')).toBe(false);
        expect(isMerchantSimilar('amazon', 'target')).toBe(false);
        expect(isMerchantSimilar('uber', 'lyft')).toBe(false);
      });

      it('does not match merchants with no word overlap', () => {
        expect(isMerchantSimilar('starbucks coffee', 'dunkin donuts')).toBe(false);
        expect(isMerchantSimilar('home depot', 'lowes hardware')).toBe(false);
      });

      it('does not match short unrelated strings', () => {
        expect(isMerchantSimilar('abc', 'xyz')).toBe(false);
        expect(isMerchantSimilar('foo bar', 'baz qux')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('handles empty strings', () => {
        expect(isMerchantSimilar('', '')).toBe(true);
        expect(isMerchantSimilar('chase', '')).toBe(true); // empty is contained in everything
        expect(isMerchantSimilar('', 'chase')).toBe(true);
      });

      it('handles strings with only short words', () => {
        // When both have no significant words, falls back to substring matching
        expect(isMerchantSimilar('a b c', 'a b')).toBe(true); // substring match
        expect(isMerchantSimilar('x y', 'z w')).toBe(false);
      });

      it('handles single character differences', () => {
        expect(isMerchantSimilar('chase', 'chases')).toBe(true); // one contains the other
        expect(isMerchantSimilar('uber', 'uber1')).toBe(true);
      });
    });
  });
});
