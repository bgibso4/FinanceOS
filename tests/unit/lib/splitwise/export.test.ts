import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  SplitwiseExportError,
  fingerprint,
  groupFromFileName,
  readSplitwiseExport,
} from '@/lib/splitwise/export';

const FIXTURES = join(process.cwd(), 'tests/fixtures/splitwise');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const ALL = [
  'trip-13_2026-11-08_export.csv',
  'trip-pair_2026-11-08_export.csv',
  'everyday_2026-11-08_export.csv',
];
const HEADER = 'Date,Description,Category,Cost,Currency,Person A,Me';

describe('readSplitwiseExport', () => {
  it('trip13YieldsYourRows', () => {
    const r = readSplitwiseExport(fixture(ALL[0]), 'Me');
    expect(r.people).toHaveLength(13);
    expect(r.rows).toHaveLength(24);
    expect(r.others).toHaveLength(16);
    expect(r.total).toBe(0);
  });

  it('tripPairYieldsAllRows', () => {
    const r = readSplitwiseExport(fixture(ALL[1]), 'Me');
    expect(r.rows).toHaveLength(8);
    expect(r.others).toHaveLength(0);
    expect(r.rows.at(-1)?.category).toBe('Payment');
  });

  it('quotedDescriptionParsed', () => {
    const r = readSplitwiseExport(fixture(ALL[2]), 'Me');
    expect(r.rows.map((x) => x.description)).toContain('Tapas dinner (Feb 4, 2024)');
  });

  it('blankLinesAndTotalRowAreNotExpenses', () => {
    const r = readSplitwiseExport(fixture(ALL[2]), 'Me');
    expect(r.rows).toHaveLength(40);
    expect(r.rows.some((x) => x.description === 'Total balance' || x.description === '')).toBe(
      false
    );
  });

  it.each(ALL)('yourColumnSumsToTotal %s', (name) => {
    const r = readSplitwiseExport(fixture(name), 'Me');
    const sumCents = r.rows.reduce((s, x) => s + Math.round(x.amount * 100), 0);
    expect(sumCents).toBe(Math.round(r.total * 100));
  });

  it('othersAreRowsWhereYourColumnIsZero', () => {
    const text = `${HEADER}\n\n2026-01-01,Mine,General,10.00,USD,5.00,-5.00\n2026-01-02, Theirs ,General,8.00,USD,8.00,0.00\n\n2026-01-03,Total balance, , ,USD,0.00,-5.00\n`;
    const r = readSplitwiseExport(text, 'Me');
    expect(r.rows.map((x) => x.description)).toEqual(['Mine']);
    expect(r.others.map((x) => x.description)).toEqual(['Theirs']);
    expect(r.total).toBe(-5);
    expect(r.rows[0]).toEqual({
      date: '2026-01-01',
      description: 'Mine',
      category: 'General',
      cost: 10,
      currency: 'USD',
      amount: -5,
    });
  });

  it('missingPersonListsNames', () => {
    expect(() => readSplitwiseExport(fixture(ALL[1]), 'Nobody')).toThrow(/Nobody.*Person A, Me/);
    expect(() => readSplitwiseExport(fixture(ALL[1]), 'Nobody')).toThrow(SplitwiseExportError);
  });

  it('notAnExportIsRejected', () => {
    expect(() => readSplitwiseExport('Date,Amount,Memo\n2026-01-01,5,x\n', 'Me')).toThrow(
      /Splitwise/
    );
    expect(() => readSplitwiseExport('', 'Me')).toThrow(SplitwiseExportError);
  });

  it('noExpenseRowsIsRejected', () => {
    expect(() => readSplitwiseExport(`${HEADER}\n\n`, 'Me')).toThrow(/no expenses/i);
  });

  it('nonNumericCellNamesTheRow', () => {
    const text = `${HEADER}\n\n2026-01-01,A,General,10.00,USD,5.00,-5.00\n2026-01-02,B,General,abc,USD,5.00,-5.00\n`;
    expect(() => readSplitwiseExport(text, 'Me')).toThrow(/Row 4/);
  });

  it('badDateNamesTheRow', () => {
    const text = `${HEADER}\n\n2026-01-01,A,General,10.00,USD,5.00,-5.00\n01/02/2026,B,General,8.00,USD,4.00,-4.00\n`;
    expect(() => readSplitwiseExport(text, 'Me')).toThrow(SplitwiseExportError);
    expect(() => readSplitwiseExport(text, 'Me')).toThrow(
      'Row 4 has "01/02/2026" in the Date column, which is not a YYYY-MM-DD date.'
    );
  });

  it('leadingBomIsIgnored', () => {
    const r = readSplitwiseExport(`\uFEFF${fixture(ALL[1])}`, 'Me');
    expect(r.rows).toHaveLength(8);
  });

  it.each(['', '  \n\r\n '])('emptyFileIsRejected %j', (text) => {
    expect(() => readSplitwiseExport(text, 'Me')).toThrow(SplitwiseExportError);
    expect(() => readSplitwiseExport(text, 'Me')).toThrow('The file is empty.');
  });

  it('unterminatedQuoteIsAnExportError', () => {
    const text = `${HEADER}\n\n2026-01-01,"A,General,10.00,USD,5.00,-5.00\n`;
    expect(() => readSplitwiseExport(text, 'Me')).toThrow(SplitwiseExportError);
    expect(() => readSplitwiseExport(text, 'Me')).toThrow(/never closed/);
  });
});

describe('groupFromFileName', () => {
  it('readsTheGroupFromAnExportName', () => {
    expect(groupFromFileName('trip-pair_2026-11-08_export.csv')).toBe('trip-pair');
    expect(groupFromFileName('my_group_2026-11-08_export.csv')).toBe('my_group');
  });

  it.each([
    'trip-pair_2026-11-08_export (1).csv',
    'trip-pair_2026-11-08_export 2.csv',
    'trip-pair_2026-11-08_export-1.csv',
  ])('browserDuplicateSuffixKeepsTheGroup %s', (name) => {
    expect(groupFromFileName(name)).toBe('trip-pair');
  });

  it('renamedFileHasNoGroup', () => {
    expect(groupFromFileName('statement.csv')).toBeNull();
    expect(groupFromFileName('trip-pair_export.csv')).toBeNull();
  });
});

describe('fingerprint', () => {
  it('joinsFieldsWithTwoDecimals', () => {
    expect(fingerprint({ date: '2026-01-01', description: 'X', cost: 10, amount: -5.5 })).toBe(
      '2026-01-01|X|10.00|-5.50'
    );
  });
});
