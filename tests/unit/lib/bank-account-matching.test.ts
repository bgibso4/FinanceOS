import { describe, it, expect } from 'vitest';
import {
  matchConnectionsToAccounts,
  mapBankAccountType,
  normalizeAccountName,
  isAccountIgnored,
  type ExistingConnection,
  type ProviderAccount,
} from '@/lib/bank-account-matching';

function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    externalId: 'acc_new_1',
    name: 'Sapphire Reserve',
    type: 'credit',
    subtype: 'credit_card',
    lastFour: '7176',
    ...overrides,
  };
}

function connection(overrides: Partial<ExistingConnection> = {}): ExistingConnection {
  return {
    id: 'conn-1',
    externalId: 'acc_old_1',
    name: 'Sapphire Reserve',
    type: 'credit',
    subtype: 'credit_card',
    lastFour: '7176',
    ...overrides,
  };
}

describe('matchConnectionsToAccounts', () => {
  it('matches on exact external id first', () => {
    const conn = connection({ externalId: 'acc_same', lastFour: '0000' });
    const target = account({ externalId: 'acc_same', lastFour: '9999', name: 'Renamed' });
    const decoy = account({ externalId: 'acc_other', lastFour: '0000' });

    const result = matchConnectionsToAccounts([conn], [decoy, target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
    expect(result.unmatchedConnections).toHaveLength(0);
  });

  it('falls back to last four plus subtype when the external id changed', () => {
    const conn = connection({ externalId: 'acc_old_1', lastFour: '7176', subtype: 'credit_card' });
    const wrongSubtype = account({ externalId: 'acc_a', lastFour: '7176', subtype: 'checking' });
    const target = account({ externalId: 'acc_b', lastFour: '7176', subtype: 'credit_card' });

    const result = matchConnectionsToAccounts([conn], [wrongSubtype, target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
  });

  it('falls back to last four alone when no subtype matches', () => {
    const conn = connection({ externalId: 'acc_old_1', lastFour: '1130', subtype: 'credit_card' });
    const target = account({
      externalId: 'acc_b',
      lastFour: '1130',
      subtype: null as unknown as string,
    });

    const result = matchConnectionsToAccounts([conn], [target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
  });

  it('falls back to normalized name plus type when last four is missing', () => {
    const conn = connection({
      externalId: 'acc_old_1',
      lastFour: null,
      name: 'Freedom  Unlimited',
    });
    const target = account({ externalId: 'acc_b', lastFour: '1130', name: 'FREEDOM UNLIMITED' });

    const result = matchConnectionsToAccounts([conn], [target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
  });

  it('leaves both connections unmatched when they compete for one account', () => {
    const connA = connection({ id: 'conn-a', externalId: 'old-a', lastFour: '3857' });
    const connB = connection({ id: 'conn-b', externalId: 'old-b', lastFour: '3857' });
    const shared = account({ externalId: 'acc_shared', lastFour: '3857' });

    const result = matchConnectionsToAccounts([connA, connB], [shared]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedConnections.map((c) => c.id).sort()).toEqual(['conn-a', 'conn-b']);
  });

  it('never claims one account for two connections across tiers', () => {
    const exact = connection({ id: 'conn-exact', externalId: 'acc_x', lastFour: '1111' });
    const byLastFour = connection({ id: 'conn-lastfour', externalId: 'gone', lastFour: '1111' });
    const only = account({ externalId: 'acc_x', lastFour: '1111' });

    const result = matchConnectionsToAccounts([exact, byLastFour], [only]);

    expect(result.matched).toEqual([{ connectionId: 'conn-exact', account: only }]);
    expect(result.unmatchedConnections.map((c) => c.id)).toEqual(['conn-lastfour']);
  });

  it('reports every connection as unmatched when the account list is empty', () => {
    const result = matchConnectionsToAccounts([connection()], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedConnections).toHaveLength(1);
  });
});

describe('mapBankAccountType', () => {
  it('maps credit to credit', () => {
    expect(mapBankAccountType('credit')).toBe('credit');
  });

  it('maps depository to checking', () => {
    expect(mapBankAccountType('depository')).toBe('checking');
  });

  it('maps anything else to other', () => {
    expect(mapBankAccountType('investment')).toBe('other');
    expect(mapBankAccountType('')).toBe('other');
  });

  it('is case insensitive', () => {
    expect(mapBankAccountType('CREDIT')).toBe('credit');
  });
});

describe('normalizeAccountName', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeAccountName('  Chase  Sapphire-Reserve®  ')).toBe('chase sapphire reserve');
  });

  it('returns an empty string for null', () => {
    expect(normalizeAccountName(null)).toBe('');
  });
});

describe('isAccountIgnored', () => {
  const ignored = [{ externalAccountId: 'acc_ignored', institutionId: 'chase', lastFour: '4242' }];

  it('matches on external account id', () => {
    expect(
      isAccountIgnored({ externalId: 'acc_ignored', lastFour: '0000' }, 'chase', ignored)
    ).toBe(true);
  });

  it('matches on institution plus last four when the external id changed', () => {
    expect(
      isAccountIgnored({ externalId: 'acc_reissued', lastFour: '4242' }, 'chase', ignored)
    ).toBe(true);
  });

  it('does not match the same last four at a different institution', () => {
    expect(isAccountIgnored({ externalId: 'acc_other', lastFour: '4242' }, 'amex', ignored)).toBe(
      false
    );
  });

  it('does not match when nothing lines up', () => {
    expect(isAccountIgnored({ externalId: 'acc_new', lastFour: '9999' }, 'chase', ignored)).toBe(
      false
    );
  });
});
