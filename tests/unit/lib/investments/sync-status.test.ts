import { describe, it, expect } from 'vitest';
import { investmentSyncStatus } from '@/lib/investments/sync-status';
import type { InvestmentSyncResult } from '@/lib/investments/plaid-investment-sync';

const result = (
  steps: Partial<InvestmentSyncResult['steps']>,
  errors: InvestmentSyncResult['errors'] = {}
): InvestmentSyncResult => ({
  accountId: 'a',
  steps: { balance: 'ok', holdings: 'ok', transactions: 'ok', linking: 'ok', ...steps },
  errors,
  counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
});

describe('investmentSyncStatus', () => {
  it('is success when every step is ok, skipped or pending', () => {
    expect(
      investmentSyncStatus(result({ holdings: 'pending' }, { holdings: 'not ready' }))
    ).toEqual({ lastSyncStatus: 'success', lastSyncError: null });
  });

  it('is error with the failed steps when any step errored', () => {
    expect(
      investmentSyncStatus(
        result(
          { holdings: 'error', transactions: 'pending' },
          { holdings: 'boom', transactions: 'not ready' }
        )
      )
    ).toEqual({ lastSyncStatus: 'error', lastSyncError: 'holdings: boom' });
  });
});
