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
    expect(items.map((i) => [i.title, i.detail, i.amount])).toEqual([
      ['Buy · AAA', '2 sh @ $50.00', -100],
      ['Sell · AAA', '2 sh @ $10.00', 20],
      ['Dividend · BBB', null, 3.5],
      ['Interest', null, 1],
      ['Deposit', null, 500],
    ]);
    expect(items[0].date).toBe('2026-10-05');
  });

  it('merges a same-day dividend and reinvestment into one line', () => {
    const items = buildActivity([
      tx({ subtype: 'dividend', amount: -10 }),
      tx({ type: 'buy', subtype: 'buy', quantity: 0.25, price: 40, amount: 10 }),
      tx({ accountId: 'a2', type: 'buy', subtype: 'buy', quantity: 1, price: 5, amount: 5 }),
    ]);
    expect(items.map((i) => [i.accountId, i.title, i.detail, i.amount])).toEqual([
      ['a1', 'Dividend reinvested · AAA', '0.25 sh @ $40.00', 10],
      ['a2', 'Buy · AAA', '1 sh @ $5.00', -5],
    ]);
  });

  it('merges regardless of input order', () => {
    const items = buildActivity([
      tx({ type: 'buy', subtype: 'buy', quantity: 1, price: 2, amount: 2 }),
      tx({ subtype: 'dividend', amount: -2 }),
    ]);
    expect(items.map((i) => i.title)).toEqual(['Dividend reinvested · AAA']);
  });

  it('falls back to the institution’s name for unknown events', () => {
    expect(buildActivity([tx({ type: 'other', subtype: 'odd', name: 'Odd thing' })])[0].title).toBe(
      'Odd thing'
    );
  });
});
