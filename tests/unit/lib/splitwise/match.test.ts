import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { readSplitwiseExport, type SplitwiseRow } from '@/lib/splitwise/export';
import { planImport, type RememberedRow, type RowStatus } from '@/lib/splitwise/match';

const FIXTURES = join(process.cwd(), 'tests/fixtures/splitwise');
const rowsOf = (name: string): SplitwiseRow[] =>
  readSplitwiseExport(readFileSync(join(FIXTURES, name), 'utf8'), 'Me').rows;

const PAIR = rowsOf('trip-pair_2026-11-08_export.csv');
const TRIP13 = rowsOf('trip-13_2026-11-08_export.csv');

/** Remembered rows as a past import of `rows` would have stored them. */
function remember(rows: SplitwiseRow[], status: RowStatus = 'imported'): RememberedRow[] {
  return rows.map((r, i) => ({
    id: `r${String(i).padStart(3, '0')}`,
    date: r.date,
    description: r.description,
    cost: r.cost,
    amount: r.amount,
    status,
    transactionId: status === 'imported' ? `tx${i}` : null,
  }));
}

describe('planImport', () => {
  it('sameFileIsAllUnchanged', () => {
    const remembered = remember(TRIP13);
    const plan = planImport(remembered, TRIP13);
    expect(plan.unchanged).toHaveLength(TRIP13.length);
    expect(plan.unchanged.map((p) => p.incoming)).toEqual(TRIP13);
    expect(plan.unchanged.map((p) => p.row)).toEqual(remembered);
    expect(plan.edited).toEqual([]);
    expect(plan.added).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('addedRowIsAdded', () => {
    const extra: SplitwiseRow = { ...PAIR[0], date: '2026-10-20', description: 'Late lunch' };
    const plan = planImport(remember(PAIR), [...PAIR, extra]);
    expect(plan.unchanged).toHaveLength(PAIR.length);
    expect(plan.added).toEqual([extra]);
    expect(plan.edited).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('removedRowIsVanished', () => {
    const remembered = remember(PAIR);
    const plan = planImport(remembered, PAIR.slice(0, 1).concat(PAIR.slice(2)));
    expect(plan.unchanged).toHaveLength(PAIR.length - 1);
    expect(plan.vanished).toEqual([remembered[1]]);
    expect(plan.added).toEqual([]);
    expect(plan.edited).toEqual([]);
  });

  it('changedAmountIsEdited', () => {
    const remembered = remember(PAIR);
    const changed = { ...PAIR[2], amount: PAIR[2].amount - 10 };
    const incoming = PAIR.map((r, i) => (i === 2 ? changed : r));
    const plan = planImport(remembered, incoming);
    expect(plan.edited).toEqual([{ row: remembered[2], incoming: changed }]);
    expect(plan.unchanged).toHaveLength(PAIR.length - 1);
    expect(plan.added).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('changedCostIsEdited', () => {
    const remembered = remember(PAIR);
    const changed = { ...PAIR[0], cost: PAIR[0].cost + 4, amount: PAIR[0].amount - 2 };
    const incoming = PAIR.map((r, i) => (i === 0 ? changed : r));
    const plan = planImport(remembered, incoming);
    expect(plan.edited).toEqual([{ row: remembered[0], incoming: changed }]);
    expect(plan.added).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('identicalRepeatsAreCounted', () => {
    const remembered = remember([PAIR[0]]);
    const plan = planImport(remembered, [PAIR[0], { ...PAIR[0] }]);
    expect(plan.unchanged).toEqual([{ row: remembered[0], incoming: PAIR[0] }]);
    expect(plan.added).toEqual([PAIR[0]]);
    expect(plan.edited).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('dateAndDescriptionChangedIsDeletePlusAdd', () => {
    const remembered = remember(PAIR);
    const changed = { ...PAIR[1], date: '2026-10-11', description: 'Hotel night 2' };
    const incoming = PAIR.map((r, i) => (i === 1 ? changed : r));
    const plan = planImport(remembered, incoming);
    expect(plan.edited).toEqual([]);
    expect(plan.added).toEqual([changed]);
    expect(plan.vanished).toEqual([remembered[1]]);
  });

  it('twoCandidatesIsDeletePlusAdd', () => {
    const a = { ...PAIR[0], amount: -10 };
    const b = { ...PAIR[0], amount: -20 };
    const remembered = remember([a, b]);
    const changed = { ...PAIR[0], amount: -30 };
    const plan = planImport(remembered, [changed]);
    expect(plan.edited).toEqual([]);
    expect(plan.added).toEqual([changed]);
    expect(plan.vanished).toEqual(remembered);

    // and the mirror: one remembered, two incoming candidates
    const mirror = planImport(remember([a]), [b, changed]);
    expect(mirror.edited).toEqual([]);
    expect(mirror.added).toEqual([b, changed]);
    expect(mirror.vanished).toHaveLength(1);
  });

  it('skippedRowMatchesAsUnchanged', () => {
    const remembered = remember(PAIR, 'skipped');
    const plan = planImport(remembered, PAIR);
    expect(plan.unchanged).toHaveLength(PAIR.length);
    expect(plan.unchanged.every((p) => p.row.status === 'skipped')).toBe(true);
    expect(plan.added).toEqual([]);
    expect(plan.edited).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('firstImportIsAllAdded', () => {
    const plan = planImport([], PAIR);
    expect(plan.added).toEqual(PAIR);
    expect(plan.unchanged).toEqual([]);
    expect(plan.edited).toEqual([]);
    expect(plan.vanished).toEqual([]);
  });

  it('vanishedFollowsIdOrderWhateverTheInputOrder', () => {
    const remembered = remember(PAIR);
    const plan = planImport([...remembered].reverse(), []);
    expect(plan.vanished).toEqual(remembered);
  });
});
