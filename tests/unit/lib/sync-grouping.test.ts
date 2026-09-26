import { describe, it, expect } from 'vitest';
import { syncUnits, statsForAccount, type GroupableAccount } from '@/lib/sync-grouping';

const teller = (id: string): GroupableAccount => ({ id, tellerConnection: { id: `tc-${id}` } });
const plaid = (id: string, enrollmentId: string): GroupableAccount => ({
  id,
  plaidConnection: { plaidEnrollmentId: enrollmentId },
});

describe('syncUnits', () => {
  it('gives every Teller account its own unit', () => {
    const units = syncUnits([teller('a'), teller('b')]);

    expect(units).toHaveLength(2);
    expect(units.every((u) => u.provider === 'teller')).toBe(true);
    expect(units.map((u) => u.accountIds)).toEqual([['a'], ['b']]);
  });

  it('collapses all Plaid accounts in one item into a single unit', () => {
    // The regression: five Chase accounts under one item produced five requests, each
    // returning the item's 115 transactions, which the modal summed to 575.
    const units = syncUnits([
      plaid('checking', 'enr-chase'),
      plaid('freedom', 'enr-chase'),
      plaid('sapphire', 'enr-chase'),
      plaid('preferred', 'enr-chase'),
      plaid('joint', 'enr-chase'),
    ]);

    expect(units).toHaveLength(1);
    expect(units[0].provider).toBe('plaid');
    expect(units[0].accountIds).toHaveLength(5);
    expect(units[0].entryAccountId).toBe('checking');
  });

  it('keeps separate Plaid items in separate units', () => {
    const units = syncUnits([
      plaid('chase-1', 'enr-chase'),
      plaid('bilt-1', 'enr-bilt'),
      plaid('chase-2', 'enr-chase'),
    ]);

    expect(units).toHaveLength(2);
    const byEntry = Object.fromEntries(units.map((u) => [u.entryAccountId, u.accountIds]));
    expect(byEntry['chase-1']).toEqual(['chase-1', 'chase-2']);
    expect(byEntry['bilt-1']).toEqual(['bilt-1']);
  });

  it('mixes providers without merging them', () => {
    const units = syncUnits([teller('wf'), plaid('c1', 'enr-chase'), plaid('c2', 'enr-chase')]);

    expect(units).toHaveLength(2);
    expect(units.find((u) => u.provider === 'teller')?.accountIds).toEqual(['wf']);
    expect(units.find((u) => u.provider === 'plaid')?.accountIds).toEqual(['c1', 'c2']);
  });

  it('skips accounts with no connection at all', () => {
    expect(syncUnits([{ id: 'orphan' }])).toEqual([]);
  });
});

describe('statsForAccount', () => {
  const stats = {
    added: 115,
    merged: 5,
    skippedDuplicates: 0,
    skippedPending: 2,
    byAccount: [
      { accountId: 'checking', added: 40, merged: 1, skippedDuplicates: 0 },
      { accountId: 'joint', added: 2, merged: 0, skippedDuplicates: 3 },
    ],
  };

  it('returns the account row when the breakdown has one', () => {
    expect(statsForAccount(stats, 'joint', 5)).toEqual({
      added: 2,
      merged: 0,
      skippedDuplicates: 3,
      skippedPending: 2,
    });
  });

  it('does not hand an account the item-wide totals', () => {
    // The whole point: 'joint' has 2 of the item's 115.
    expect(statsForAccount(stats, 'joint', 5).added).not.toBe(115);
  });

  it('falls back to item totals only for a single-account unit', () => {
    const noBreakdown = { added: 7, merged: 1, skippedDuplicates: 0, skippedPending: 0 };

    expect(statsForAccount(noBreakdown, 'solo', 1).added).toBe(7);
  });

  it('returns zeros for a multi-account unit with no breakdown', () => {
    const noBreakdown = { added: 115, merged: 5, skippedDuplicates: 0, skippedPending: 0 };

    expect(statsForAccount(noBreakdown, 'unknown', 5)).toEqual({
      added: 0,
      merged: 0,
      skippedDuplicates: 0,
      skippedPending: 0,
    });
  });

  it('sums to the item total across the accounts in the breakdown', () => {
    const total = ['checking', 'joint']
      .map((id) => statsForAccount(stats, id, 5).added)
      .reduce((a, b) => a + b, 0);

    expect(total).toBe(42);
    expect(total).toBeLessThan(stats.added);
  });
});
