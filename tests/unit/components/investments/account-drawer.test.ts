import { describe, it, expect } from 'vitest';
import {
  drawerSections,
  drawerSubtitle,
  investmentBadge,
  type DrawerAccount,
} from '@/components/investments/account-drawer';
import { BalanceSource } from '@/lib/investments/codes';
import { SOURCE_LABEL } from '@/components/investments/format';

describe('account drawer rules', () => {
  it.each<[string, DrawerAccount, string[]]>([
    [
      'everyday, unconnected',
      { trackingMode: 'cash_flow', hasConnection: false },
      ['connection', 'reconcile'],
    ],
    [
      'synced',
      { trackingMode: 'investment', balanceSource: BalanceSource.Provider, hasConnection: true },
      ['connection', 'holdings', 'entered'],
    ],
    [
      'synced, disconnected',
      { trackingMode: 'investment', balanceSource: BalanceSource.Provider, hasConnection: false },
      ['holdings', 'entered'],
    ],
    [
      'valued',
      { trackingMode: 'investment', balanceSource: BalanceSource.Valuation, hasConnection: false },
      ['holdings', 'entered'],
    ],
    [
      'manual, connected',
      { trackingMode: 'investment', balanceSource: BalanceSource.Manual, hasConnection: true },
      ['connection', 'entered'],
    ],
  ])('drawerSections: %s', (_n, a, expected) => expect(drawerSections(a)).toEqual(expected));

  it('subtitle and badge name the source for investment accounts only', () => {
    expect(
      drawerSubtitle({
        trackingMode: 'investment',
        balanceSource: BalanceSource.Valuation,
        institution: 'Test Bank',
        hasConnection: false,
      })
    ).toBe('Test Bank · Investment · Valued');
    expect(
      drawerSubtitle({ trackingMode: 'cash_flow', institution: 'Test Bank', hasConnection: false })
    ).toBe('Test Bank');
    expect(
      investmentBadge({
        trackingMode: 'investment',
        balanceSource: BalanceSource.Provider,
        hasConnection: true,
      })
    ).toBe('Investment · Synced');
    expect(investmentBadge({ trackingMode: 'cash_flow', hasConnection: false })).toBeNull();
  });

  it('labels every balance source', () => {
    expect(SOURCE_LABEL).toEqual({
      [BalanceSource.Provider]: 'Synced',
      [BalanceSource.Valuation]: 'Valued',
      [BalanceSource.Manual]: 'Manual',
    });
  });
});
