import { describe, it, expect } from 'vitest';
import {
  normalizeTellerEnrollment,
  normalizePlaidEnrollment,
} from '@/components/institutions/normalize';

describe('normalizeTellerEnrollment', () => {
  it('maps a Teller enrollment onto the shared view model', () => {
    const view = normalizeTellerEnrollment({
      id: 'db-1',
      enrollmentId: 'enr_1',
      institutionId: 'chase',
      institutionName: 'Chase',
      status: 'connected',
      totalAccountCount: 3,
      connections: [
        {
          id: 'conn-1',
          tellerAccountId: 'acc_1',
          tellerAccountName: 'Personal Checking',
          status: 'connected',
          account: { id: 'a1', name: 'Chase Checking' },
        },
      ],
      availableAccounts: [
        {
          externalId: 'acc_2',
          name: 'Amazon Card',
          type: 'credit',
          subtype: 'credit_card',
          lastFour: '4242',
        },
      ],
      hiddenAccounts: [],
    });

    expect(view.key).toBe('teller-db-1');
    expect(view.updateTargetId).toBe('enr_1');
    expect(view.linked).toEqual([
      {
        connectionId: 'conn-1',
        externalId: 'acc_1',
        bankAccountName: 'Personal Checking',
        linkedAccountName: 'Chase Checking',
        status: 'connected',
      },
    ]);
    expect(view.discovered).toHaveLength(1);
    expect(view.totalAccountCount).toBe(3);
  });

  it('falls back to the linked count when the total is missing', () => {
    const view = normalizeTellerEnrollment({
      id: 'db-1',
      enrollmentId: 'enr_1',
      institutionId: 'chase',
      institutionName: 'Chase',
      status: 'disconnected',
      connections: [
        {
          id: 'conn-1',
          tellerAccountId: 'acc_1',
          tellerAccountName: 'Checking',
          status: 'connected',
          account: { id: 'a1', name: 'Chase Checking' },
        },
      ],
    });

    expect(view.totalAccountCount).toBe(1);
    expect(view.discovered).toEqual([]);
    expect(view.hidden).toEqual([]);
  });
});

describe('normalizePlaidEnrollment', () => {
  it('uses the DB id as the update target', () => {
    const view = normalizePlaidEnrollment({
      id: 'db-9',
      plaidItemId: 'item_9',
      institutionId: 'ins_9',
      institutionName: 'Bilt Rewards',
      status: 'connected',
      totalAccountCount: 2,
      connections: [
        {
          id: 'pc-1',
          plaidAccountId: 'pacc_1',
          plaidAccountName: 'Bilt Card',
          status: 'connected',
          account: { id: 'a9', name: 'Bilt' },
        },
      ],
      availableAccounts: [
        {
          externalId: 'pacc_2',
          name: 'New Card',
          type: 'credit',
          subtype: 'credit_card',
          lastFour: '9999',
        },
      ],
      hiddenAccounts: [],
    });

    expect(view.key).toBe('plaid-db-9');
    expect(view.updateTargetId).toBe('db-9');
    expect(view.institutionId).toBe('ins_9');
    expect(view.discovered[0].externalId).toBe('pacc_2');
  });

  it('tolerates a null institutionId', () => {
    const view = normalizePlaidEnrollment({
      id: 'db-9',
      plaidItemId: 'item_9',
      institutionId: null,
      institutionName: 'Unknown Bank',
      status: 'connected',
      connections: [],
    });

    expect(view.institutionId).toBe('');
  });
});
