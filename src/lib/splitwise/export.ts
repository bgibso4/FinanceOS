import { parseCsv } from '@/lib/csv';

export type SplitwiseRow = {
  date: string;
  description: string;
  category: string;
  cost: number;
  currency: string;
  amount: number;
};

export type SplitwiseExport = {
  people: string[];
  /** Rows where your column is not zero, in file order. */
  rows: SplitwiseRow[];
  /** Rows where your column is 0.00, in file order. */
  others: SplitwiseRow[];
  /** Your cell on the "Total balance" row. */
  total: number;
};

export class SplitwiseExportError extends Error {}

const FIXED_COLUMNS = ['Date', 'Description', 'Category', 'Cost', 'Currency'];
const TOTAL_LABEL = 'Total balance';
/** Browsers add " (1)", " 2" or "-1" before ".csv" when the same name is downloaded again. */
const FILE_NAME = /^(.+)_\d{4}-\d{2}-\d{2}_export(?: \(\d+\)| \d+|-\d+)?\.csv$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'trip-pair_2026-11-08_export.csv' (or '… (1).csv') -> 'trip-pair'; a renamed file -> null. */
export function groupFromFileName(fileName: string): string | null {
  return FILE_NAME.exec(fileName)?.[1] ?? null;
}

export function fingerprint(r: {
  date: string;
  description: string;
  cost: number;
  amount: number;
}): string {
  return `${r.date}|${r.description}|${r.cost.toFixed(2)}|${r.amount.toFixed(2)}`;
}

function toNumber(cell: string | undefined, rowNumber: number, column: string): number {
  const n = cell === undefined || cell.trim() === '' ? NaN : Number(cell);
  if (!Number.isFinite(n)) {
    throw new SplitwiseExportError(
      `Row ${rowNumber} has "${cell ?? ''}" in the ${column} column, which is not a number.`
    );
  }
  return n;
}

/** Reads a Splitwise group export, keeping the column of `person` as "your" share. */
export function readSplitwiseExport(text: string, person: string): SplitwiseExport {
  if (text.trim() === '') throw new SplitwiseExportError('The file is empty.');
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (error) {
    throw new SplitwiseExportError((error as Error).message);
  }
  const header = table[0] ?? [];
  if (!FIXED_COLUMNS.every((name, i) => header[i]?.trim() === name)) {
    throw new SplitwiseExportError(
      'This is not a Splitwise export: the first row should start Date, Description, Category, Cost, Currency.'
    );
  }

  const people = header.slice(FIXED_COLUMNS.length).map((name) => name.trim());
  const personColumn = people.indexOf(person.trim());
  if (personColumn < 0) {
    throw new SplitwiseExportError(
      `No column named "${person}" in this export. The people in it are: ${people.join(', ')}.`
    );
  }
  const cellIndex = FIXED_COLUMNS.length + personColumn;

  const rows: SplitwiseRow[] = [];
  const others: SplitwiseRow[] = [];
  let total = 0;

  table.slice(1).forEach((cells, i) => {
    const rowNumber = i + 2;
    if (cells.every((c) => c.trim() === '')) return;
    const description = (cells[1] ?? '').trim();
    if (description === TOTAL_LABEL) {
      total = toNumber(cells[cellIndex], rowNumber, person);
      return;
    }
    const date = (cells[0] ?? '').trim();
    if (!DATE.test(date)) {
      throw new SplitwiseExportError(
        `Row ${rowNumber} has "${date}" in the Date column, which is not a YYYY-MM-DD date.`
      );
    }
    const row: SplitwiseRow = {
      date,
      description,
      category: (cells[2] ?? '').trim(),
      cost: toNumber(cells[3], rowNumber, 'Cost'),
      currency: (cells[4] ?? '').trim(),
      amount: toNumber(cells[cellIndex], rowNumber, person),
    };
    (row.amount !== 0 ? rows : others).push(row);
  });

  if (rows.length + others.length === 0) {
    throw new SplitwiseExportError('This export has no expenses in it.');
  }
  return { people, rows, others, total };
}
