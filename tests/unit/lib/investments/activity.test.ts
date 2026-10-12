import { describe, it, expect } from 'vitest';
import { utcDay } from '@/lib/investments/dates';
import { buildActivity, type ActivityInput } from '@/lib/investments/activity';

let n = 0;
const tx = (over: Partial<ActivityInput>): ActivityInput => ({
  id: `t${n++}`,
  accountId: 'a1',
  date: utcDay('2026-10-01'),
  type: 'cash',
  subtype: 'deposit',
  name: 'Raw name',
  quantity: null,
  price: null,
  amount: 0,
  currency: 'USD',
  securityId: 's1',
  ticker: 'AAA',
  securityName: 'Triple A',
  ...over,
});

describe('buildActivity', () => {
  it('titles common trades and cash events', () => {
    const items = buildActivity([
      tx({
        type: 'buy',
        subtype: 'buy',
        quantity: 2,
        price: 50,
        amount: 100,
        date: utcDay('2026-10-05'),
      }),
      tx({
        type: 'sell',
        subtype: 'sell',
        quantity: -2,
        price: 10,
        amount: -20,
        date: utcDay('2026-10-04'),
      }),
      tx({
        subtype: 'dividend',
        amount: -3.5,
        date: utcDay('2026-10-03'),
        securityId: 's2',
        ticker: 'BBB',
      }),
      tx({
        subtype: 'interest',
        amount: -1,
        securityId: null,
        ticker: null,
        date: utcDay('2026-10-02'),
      }),
      tx({ subtype: 'deposit', amount: -500, securityId: null, ticker: null }),
    ]);
    expect(items.map((i) => [i.title, i.trade, i.amount])).toEqual([
      ['Buy · AAA', { quantity: 2, price: 50 }, -100],
      ['Sell · AAA', { quantity: 2, price: 10 }, 20],
      ['Dividend · BBB', null, 3.5],
      ['Interest', null, 1],
      ['Deposit', null, 500],
    ]);
    expect(items[0].date).toBe('2026-10-05');
  });

  it('merges a same-day dividend and reinvestment into one line', () => {
    const items = buildActivity([
      tx({ subtype: 'dividend', amount: -10 }),
      tx({ accountId: 'a2', type: 'buy', subtype: 'buy', quantity: 1, price: 5, amount: 5 }),
      tx({ type: 'buy', subtype: 'buy', quantity: 0.25, price: 40, amount: 10 }),
    ]);
    expect(items.map((i) => [i.accountId, i.title, i.trade, i.amount])).toEqual([
      ['a1', 'Dividend reinvested · AAA', { quantity: 0.25, price: 40 }, 10],
      ['a2', 'Buy · AAA', { quantity: 1, price: 5 }, -5],
    ]);
  });

  it('merges a dividend with only one of two same-day buys and keeps the other', () => {
    const items = buildActivity([
      tx({ subtype: 'dividend', amount: -10 }),
      tx({ type: 'buy', subtype: 'buy', quantity: 1, price: 4, amount: 4 }),
      tx({ type: 'buy', subtype: 'buy', quantity: 2, price: 3, amount: 6 }),
    ]);
    expect(items.map((i) => [i.title, i.trade, i.amount])).toEqual([
      ['Dividend reinvested · AAA', { quantity: 1, price: 4 }, 10],
      ['Buy · AAA', { quantity: 2, price: 3 }, -6],
    ]);
  });

  it.each<[string, Partial<ActivityInput>]>([
    ['a different security', { securityId: 's2', ticker: 'BBB' }],
    ['a different day', { date: utcDay('2026-10-02') }],
    ['a missing security id', { securityId: null }],
  ])('does not merge a dividend with a buy of %s', (_label, over) => {
    const items = buildActivity([
      tx({ subtype: 'dividend', amount: -10, securityId: over.securityId === null ? null : 's1' }),
      tx({ type: 'buy', subtype: 'buy', quantity: 1, price: 10, amount: 10, ...over }),
    ]);
    expect(items.map((i) => i.title)).toHaveLength(2);
    expect(items.map((i) => i.title)).not.toContain('Dividend reinvested · AAA');
  });

  it('keeps a dividend with no matching buy as a plain dividend', () => {
    const items = buildActivity([tx({ subtype: 'dividend', amount: -2 })]);
    expect(items.map((i) => [i.title, i.trade])).toEqual([['Dividend · AAA', null]]);
  });

  it('merges regardless of input order', () => {
    const items = buildActivity([
      tx({ type: 'buy', subtype: 'buy', quantity: 1, price: 2, amount: 2 }),
      tx({ subtype: 'dividend', amount: -2 }),
    ]);
    expect(items.map((i) => i.title)).toEqual(['Dividend reinvested · AAA']);
  });

  it('keeps each event in its transaction currency', () => {
    const [item] = buildActivity([
      tx({ type: 'buy', subtype: 'buy', quantity: 2, price: 7.5, amount: 15, currency: 'CAD' }),
    ]);
    expect(item).toMatchObject({
      currency: 'CAD',
      amount: -15,
      trade: { quantity: 2, price: 7.5 },
    });
  });

  it('falls back to the institution’s name for unknown events', () => {
    expect(buildActivity([tx({ type: 'other', subtype: 'odd', name: 'Odd thing' })])[0].title).toBe(
      'Odd thing'
    );
  });
});
