import { fingerprint, type SplitwiseRow } from './export';

export type RowStatus = 'imported' | 'skipped' | 'kept' | 'dismissed';

/** A row of yours that an earlier import of the group saw, with what happened to it. */
export type RememberedRow = {
  id: string;
  date: string;
  description: string;
  cost: number;
  amount: number;
  status: RowStatus;
  transactionId: string | null;
};

export type Pair = { row: RememberedRow; incoming: SplitwiseRow };

/** unchanged, edited and added follow file order; vanished follows remembered id order. */
export type ImportPlan = {
  unchanged: Pair[];
  edited: Pair[];
  added: SplitwiseRow[];
  vanished: RememberedRow[];
};

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

const dateAndDescription = (r: { date: string; description: string }) =>
  `${r.date}|${r.description}`;

/** Compares a group's remembered rows with a new export of it (spec §2). */
export function planImport(remembered: RememberedRow[], incoming: SplitwiseRow[]): ImportPlan {
  const byId = [...remembered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 1. Exact fingerprints, as multisets: each remembered row matches at most once.
  const unmatched = groupBy(byId, fingerprint);
  const unchanged: Pair[] = [];
  const leftIncoming: SplitwiseRow[] = [];
  for (const row of incoming) {
    const match = unmatched.get(fingerprint(row))?.shift();
    if (match) unchanged.push({ row: match, incoming: row });
    else leftIncoming.push(row);
  }
  const matched = new Set(unchanged.map((p) => p.row));
  const leftRemembered = byId.filter((r) => !matched.has(r));

  // 2. Edits: a date|description shared by exactly one leftover on each side.
  const rememberedGroups = groupBy(leftRemembered, dateAndDescription);
  const incomingGroups = groupBy(leftIncoming, dateAndDescription);
  const edited: Pair[] = [];
  const added: SplitwiseRow[] = [];
  for (const row of leftIncoming) {
    const key = dateAndDescription(row);
    const candidates = rememberedGroups.get(key);
    if (candidates?.length === 1 && incomingGroups.get(key)?.length === 1) {
      edited.push({ row: candidates[0], incoming: row });
    } else {
      added.push(row);
    }
  }
  const editedRows = new Set(edited.map((p) => p.row));

  // 3. Everything else: added above, vanished here.
  const vanished = leftRemembered.filter((r) => !editedRows.has(r));
  return { unchanged, edited, added, vanished };
}
