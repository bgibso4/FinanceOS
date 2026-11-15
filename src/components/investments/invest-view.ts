import type { LeftOutReason, PlanRow } from '@/lib/investments/targets/planner';

/** "1,000" or "$1,000" as 1000; empty, invalid or negative text is null. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

/** "Stocks · US" for a row of a class split by region, else the class name. */
export const rowTag = (row: PlanRow): string =>
  row.className ? `${row.className} · ${row.name}` : row.name;

const LEFT_OUT_TEXT: Record<LeftOutReason, string> = {
  account_excluded: 'Account left out',
  typed_balance: 'Typed-in balance, no funds to count',
  cash: 'Cash waiting to be invested',
  not_counted: 'Not counted toward a target',
};
export const leftOutText = (reason: LeftOutReason): string => LEFT_OUT_TEXT[reason];

/** One line for each target set that doesn't add to 100 (to 2 places). */
export function scaleNotes(totals: { countryWeightPct: number; classPct: number }): string[] {
  const off = (n: number) => Math.abs(n - 100) > 0.005;
  const notes: string[] = [];
  if (off(totals.countryWeightPct))
    notes.push(
      `Your country weights add to ${totals.countryWeightPct.toFixed(2)}%; scaled to 100%.`
    );
  if (off(totals.classPct))
    notes.push(`Your class targets add to ${totals.classPct.toFixed(2)}%; scaled to 100%.`);
  return notes;
}
