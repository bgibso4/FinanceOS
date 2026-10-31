import { describe, expect, it } from 'vitest';

import { BalanceSource } from '@/lib/investments/codes';
import {
  classifyPastBalances,
  parseBalanceText,
  parseDayText,
  parsePastBalances,
  type ClassifyContext,
} from '@/lib/investments/past-balances';

describe('parseDayText', () => {
  it('reads ISO and US dates and refuses invalid calendar days', () => {
    expect(parseDayText('2025-03-31')).toBe('2025-03-31');
    expect(parseDayText('3/31/2025')).toBe('2025-03-31');
    expect(parseDayText('12/1/2025')).toBe('2025-12-01');
    for (const bad of ['2025-02-30', '2/30/2025', '31/3/2025', '2025-3-31', 'Q4 total', ''])
      expect(parseDayText(bad)).toBeNull();
  });
});

describe('parseBalanceText', () => {
  it('parses balances with symbols, codes, commas and negatives', () => {
    expect(parseBalanceText('31,904.22')).toBe(31904.22);
    expect(parseBalanceText('$36,950.10')).toBe(36950.1);
    expect(parseBalanceText('CA$ 1,200')).toBe(1200);
    expect(parseBalanceText('1200 CAD')).toBe(1200);
    expect(parseBalanceText('USD 5')).toBe(5);
    expect(parseBalanceText('-12.5')).toBe(-12.5);
    expect(parseBalanceText('(1,234.56)')).toBe(-1234.56);
    expect(parseBalanceText('−40')).toBe(-40); // U+2212, as the app formats
    expect(parseBalanceText('10.256')).toBe(10.26);
    for (const bad of ['—', '', '12abc', '1.2.3', '$']) expect(parseBalanceText(bad)).toBeNull();
  });
  it('refuses commas that are not thousands groups and spaces between digits', () => {
    for (const bad of ['1,5', '100 200', '1.234,56', '12,34', '1,2345', ',100', '1,000,00'])
      expect(parseBalanceText(bad)).toBeNull();
    expect(parseBalanceText('1,000,000.5')).toBe(1000000.5);
  });
  it('reads a negative zero as zero', () => {
    expect(Object.is(parseBalanceText('-0'), 0)).toBe(true);
    expect(Object.is(parseBalanceText('(0.00)'), 0)).toBe(true);
  });
});

describe('parsePastBalances', () => {
  it('splits a leading date from the balance on tab, comma or spaces', () => {
    expect(
      parsePastBalances('2025-03-31\t31,904.22\n9/30/2025, $36,950.10\n2025-12-31   100')
    ).toEqual([
      { kind: 'ok', text: '2025-03-31\t31,904.22', date: '2025-03-31', balance: 31904.22 },
      { kind: 'ok', text: '9/30/2025, $36,950.10', date: '2025-09-30', balance: 36950.1 },
      { kind: 'ok', text: '2025-12-31   100', date: '2025-12-31', balance: 100 },
    ]);
  });
  it('ignores blank lines', () => {
    expect(parsePastBalances('\n2025-01-31,1\n\n  \n')).toHaveLength(1);
  });
  it('reads CRLF pastes and marks a header row unreadable', () => {
    const lines = parsePastBalances('Date,Balance\r\n2025-01-31,1\r\n');
    expect(lines.map((l) => l.kind)).toEqual(['unreadable', 'ok']);
    expect(lines[1]).toMatchObject({ text: '2025-01-31,1', balance: 1 });
  });
  it('reads pastes whose lines end in a bare carriage return', () => {
    expect(parsePastBalances('2025-01-31,1\r2025-02-28,2\r').map((l) => l.text)).toEqual([
      '2025-01-31,1',
      '2025-02-28,2',
    ]);
  });
  it('marks lines missing either part unreadable', () => {
    expect(parsePastBalances('2025-01-31\nQ4 total\t—\n100').map((l) => l.kind)).toEqual([
      'unreadable',
      'unreadable',
      'unreadable',
    ]);
  });
});

describe('classifyPastBalances', () => {
  const ctx: ClassifyContext = {
    entered: [
      { date: '2025-06-30', balance: 50 },
      { date: '2025-09-30', balance: 70 },
    ],
    enterBefore: '2026-03-03',
    source: BalanceSource.Provider,
    today: '2026-10-09',
  };
  it('gives every line one status and saves only new and replacing ones', () => {
    const text = [
      '2025-03-31,10', // new
      '2025-06-30,55', // replaces 50
      '2025-09-30,70', // already entered
      '2026-03-03,1', // skipped: on the cutoff
      '2026-12-01,1', // future (checked before the cutoff)
      '2025-03-31,11', // repeated
      'nope', // unreadable
    ].join('\n');
    const out = classifyPastBalances(parsePastBalances(text), ctx);
    expect(out.map((c) => c.status)).toEqual([
      { kind: 'new' },
      { kind: 'replaces', previous: 50 },
      { kind: 'already' },
      { kind: 'skipped', source: BalanceSource.Provider, from: '2026-03-03' },
      { kind: 'future' },
      { kind: 'repeated' },
      { kind: 'unreadable' },
    ]);
    expect(out.map((c) => c.saves)).toEqual([true, true, false, false, false, false, false]);
  });
  it('has no cutoff for a manual account and allows today', () => {
    const out = classifyPastBalances(parsePastBalances('2026-10-09,5\n2026-05-01,6'), {
      ...ctx,
      enterBefore: null,
      source: BalanceSource.Manual,
    });
    expect(out.map((c) => c.status.kind)).toEqual(['new', 'new']);
  });
});
