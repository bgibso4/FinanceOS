import { describe, it, expect } from 'vitest';
import { checkAccountUpdate } from '@/lib/investments/account-guard';
import { BalanceSource } from '@/lib/investments/codes';

const inv = (balanceSource: BalanceSource) => ({ trackingMode: 'investment', balanceSource });
const everyday = { trackingMode: 'cash_flow', balanceSource: null };

describe('checkAccountUpdate', () => {
  it('refuses converting to or from an investment account', () => {
    expect(() =>
      checkAccountUpdate(everyday, { trackingMode: 'investment' }, { synced: false })
    ).toThrow('An account can’t be converted to or from an investment account');
    expect(() =>
      checkAccountUpdate(
        inv(BalanceSource.Manual),
        { trackingMode: 'balance_only' },
        { synced: false }
      )
    ).toThrow('An account can’t be converted to or from an investment account');
  });

  it('allows an unchanged tracking mode and source', () => {
    expect(
      checkAccountUpdate(
        inv(BalanceSource.Manual),
        { trackingMode: 'investment', balanceSource: BalanceSource.Manual },
        { synced: false }
      )
    ).toEqual({ switchTo: null });
    expect(
      checkAccountUpdate(
        everyday,
        { trackingMode: 'cash_flow', balanceSource: null },
        { synced: false }
      )
    ).toEqual({ switchTo: null });
    expect(checkAccountUpdate(inv(BalanceSource.Provider), {}, { synced: true })).toEqual({
      switchTo: null,
    });
  });

  it('allows changing between everyday tracking modes', () => {
    expect(
      checkAccountUpdate(everyday, { trackingMode: 'balance_only' }, { synced: false })
    ).toEqual({ switchTo: null });
  });

  it('refuses a balance source on an everyday account', () => {
    expect(() =>
      checkAccountUpdate(everyday, { balanceSource: BalanceSource.Manual }, { synced: false })
    ).toThrow('Only investment accounts have a balance source');
  });

  it('refuses clearing an investment account’s source', () => {
    expect(() =>
      checkAccountUpdate(inv(BalanceSource.Manual), { balanceSource: null }, { synced: false })
    ).toThrow('An investment account needs a balance source');
  });

  it('refuses Synced without a connection', () => {
    expect(() =>
      checkAccountUpdate(
        inv(BalanceSource.Manual),
        { balanceSource: BalanceSource.Provider },
        { synced: false }
      )
    ).toThrow('Synced needs a connection to this account’s institution.');
  });

  it('refuses leaving Synced while connected', () => {
    for (const to of [BalanceSource.Valuation, BalanceSource.Manual]) {
      expect(() =>
        checkAccountUpdate(inv(BalanceSource.Provider), { balanceSource: to }, { synced: true })
      ).toThrow('Disconnect to value it or enter balances yourself.');
    }
  });

  it('allows leaving Synced once the connection is gone', () => {
    expect(
      checkAccountUpdate(
        inv(BalanceSource.Provider),
        { balanceSource: BalanceSource.Valuation },
        { synced: false }
      )
    ).toEqual({ switchTo: BalanceSource.Valuation });
  });

  it('allows switching to Synced once connected', () => {
    expect(
      checkAccountUpdate(
        inv(BalanceSource.Manual),
        { balanceSource: BalanceSource.Provider },
        { synced: true }
      )
    ).toEqual({ switchTo: BalanceSource.Provider });
  });

  it('allows switching between Valued and Manual', () => {
    expect(
      checkAccountUpdate(
        inv(BalanceSource.Valuation),
        { balanceSource: BalanceSource.Manual },
        { synced: false }
      )
    ).toEqual({ switchTo: BalanceSource.Manual });
    expect(
      checkAccountUpdate(
        inv(BalanceSource.Manual),
        { trackingMode: 'investment', balanceSource: BalanceSource.Valuation },
        { synced: false }
      )
    ).toEqual({ switchTo: BalanceSource.Valuation });
  });
});
