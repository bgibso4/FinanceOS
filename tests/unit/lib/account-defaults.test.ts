import { describe, it, expect } from 'vitest';
import { getDefaultTrackingMode, defaultBalanceSource } from '@/lib/account-defaults';
import { BalanceSource } from '@/lib/investments/codes';

describe('account defaults', () => {
  it.each([
    ['brokerage', 'investment'],
    ['retirement', 'investment'],
    ['crypto', 'investment'],
    ['loan', 'balance_only'],
    ['checking', 'cash_flow'],
    ['other', 'cash_flow'],
  ])('getDefaultTrackingMode(%s) is %s', (type, mode) => {
    expect(getDefaultTrackingMode(type)).toBe(mode);
  });

  it('defaultBalanceSource is Synced only for a synced investment account', () => {
    expect(defaultBalanceSource('investment', { synced: true })).toBe(BalanceSource.Provider);
    expect(defaultBalanceSource('investment', { synced: false })).toBe(BalanceSource.Manual);
    expect(defaultBalanceSource('cash_flow', { synced: true })).toBeNull();
    expect(defaultBalanceSource('balance_only', { synced: false })).toBeNull();
  });
});
