/**
 * Quote-aware CSV reader (RFC 4180): quoted fields may contain commas, newlines and
 * doubled quotes (""). Rows split on CRLF or LF. Cells are not trimmed, and a blank
 * line yields a [""] row so callers decide what to do with it. A leading UTF-8 byte order
 * mark is dropped. A quoted field still open at the end of the text throws, naming its row.
 */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (inQuotes) {
    throw new Error(`Row ${rows.length + 1} has a quoted field that is never closed.`);
  }

  // Final row without a trailing newline (a trailing newline adds no extra row).
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
