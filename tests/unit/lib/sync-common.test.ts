import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { isMerchantSimilar, withSyncLock, isUniqueConstraintError } from '@/lib/sync-common';

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

  describe('withSyncLock', () => {
    it('runs operations with the same key one at a time', async () => {
      let active = 0;
      let maxActive = 0;
      const op = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return 'done';
      };

      await Promise.all([
        withSyncLock('acct-1', op),
        withSyncLock('acct-1', op),
        withSyncLock('acct-1', op),
      ]);

      expect(maxActive).toBe(1);
    });

    it('runs operations with different keys concurrently', async () => {
      let active = 0;
      let maxActive = 0;
      const op = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
      };

      await Promise.all([withSyncLock('acct-1', op), withSyncLock('acct-2', op)]);

      expect(maxActive).toBe(2);
    });

    it('releases the lock when an operation throws so later operations still run', async () => {
      await expect(
        withSyncLock('acct-err', async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      const result = await withSyncLock('acct-err', async () => 'recovered');
      expect(result).toBe('recovered');
    });

    it('returns the operation result', async () => {
      const result = await withSyncLock('acct-result', async () => 42);
      expect(result).toBe(42);
    });
  });

  describe('isUniqueConstraintError', () => {
    it('returns true for Prisma P2002 unique-constraint errors', () => {
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    it('returns false for other Prisma error codes', () => {
      const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      });
      expect(isUniqueConstraintError(err)).toBe(false);
    });

    it('returns false for generic errors and non-errors', () => {
      expect(isUniqueConstraintError(new Error('boom'))).toBe(false);
      expect(isUniqueConstraintError('nope')).toBe(false);
      expect(isUniqueConstraintError(null)).toBe(false);
    });
  });
});
