import { describe, it, expect } from 'vitest';
import {
  accountDots,
  accountNotices,
  activityEmptyText,
  freshnessText,
  navMeta,
  plural,
  sparkTone,
} from '@/components/investments/account-states';
import { makeAccount } from '../../../helpers/investment-overview';

describe('account states', () => {
  it('lists notices in priority order with their copy', () => {
    const a = makeAccount({
      balanceSource: 'valuation',
      prices: { asOf: '2026-10-06', stale: true },
      status: {
        needsReauth: { since: '2026-10-01' },
        waiting: { showingFrom: '2026-10-02' },
        unpriced: [{ securityId: 's', label: 'ZZZ' }],
        tradesReported: true,
      },
    });
    expect(accountNotices(a)).toEqual([
      {
        kind: 'reauth',
        tone: 'err',
        lead: 'Test Bank needs to be reconnected.',
        text: 'Authorization expired on Oct 1, so balances and holdings stopped updating. Nothing is lost — reconnecting resumes from where it left off.',
      },
      {
        kind: 'waiting',
        tone: 'warn',
        lead: 'Waiting on Test Bank.',
        text: 'Test Bank hasn’t finished preparing holdings and activity for this connection. Showing data from Oct 2; the balance is current.',
      },
      {
        kind: 'stale',
        tone: 'warn',
        lead: 'Prices are from Oct 6.',
        text: 'The price source didn’t respond, so this balance uses the last stored prices.',
      },
      {
        kind: 'unpriced',
        tone: 'warn',
        lead: 'ZZZ has no price source.',
        text: 'It’s valued at its last known price. Check the symbol or set a price manually.',
      },
    ]);
    expect(accountDots(a)).toEqual([
      { tone: 'err', title: 'Test Bank needs reconnection' },
      { tone: 'warn', title: 'Waiting on Test Bank' },
      { tone: 'warn', title: 'A holding has no price source' },
    ]);
  });

  it('pluralizes several unpriced holdings and has no notices when healthy', () => {
    const many = makeAccount({
      status: {
        needsReauth: null,
        waiting: null,
        unpriced: [
          { securityId: 'a', label: 'AAA' },
          { securityId: 'b', label: 'BBB' },
        ],
        tradesReported: true,
      },
    });
    expect(accountNotices(many)[0].lead).toBe('AAA, BBB have no price source.');
    expect(accountNotices(makeAccount())).toEqual([]);
  });

  it('describes freshness per source', () => {
    expect(freshnessText(makeAccount(), '2026-10-09')).toMatch(/^Synced Oct \d{1,2}, /);
    expect(
      freshnessText(
        makeAccount({ status: { ...makeAccount().status, needsReauth: { since: '2026-10-01' } } }),
        '2026-10-09'
      )
    ).toBe('Last synced Oct 9');
    expect(
      freshnessText(
        makeAccount({ balanceSource: 'valuation', prices: { asOf: '2026-10-08', stale: false } }),
        '2026-10-09'
      )
    ).toBe('Prices as of Oct 8 close');
    expect(
      freshnessText(makeAccount({ balanceSource: 'manual', asOf: '2026-07-12' }), '2026-10-09')
    ).toBe('Last entry Jul 12 · 89 days ago');
    expect(
      freshnessText(makeAccount({ balanceSource: 'manual', asOf: '2026-10-09' }), '2026-10-09')
    ).toBe('Last entry Oct 9 · today');
  });

  it('builds navigator meta, sparkline tone and plurals', () => {
    expect(navMeta(makeAccount())).toBe('Test Bank · Taxable');
    expect(navMeta(makeAccount({ balanceSource: 'manual', asOf: '2026-07-12' }))).toBe(
      'Test Bank · Taxable · as of Jul 12'
    );
    expect(sparkTone(makeAccount())).toBe('up');
    expect(sparkTone(makeAccount({ change: { start: 2, end: 1, delta: -1, pct: -50 } }))).toBe(
      'down'
    );
    expect(sparkTone(makeAccount({ balanceSource: 'manual', change: null }))).toBe('muted');
    expect(plural(1, 'account')).toBe('1 account');
    expect(plural(3, 'institution')).toBe('3 institutions');
  });

  it('says when an institution does not report trades', () => {
    expect(
      activityEmptyText(makeAccount({ status: { ...makeAccount().status, tradesReported: false } }))
    ).toBe('Test Bank doesn’t report trades for this account — changes show as balance movement.');
    expect(activityEmptyText(null)).toBe('No activity reported.');
  });
});
