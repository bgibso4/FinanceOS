import { normalizeMerchant } from '@/lib/categorization';
import { createImportHash } from '@/lib/import';
import { utcDay } from '@/lib/investments/dates';
import type { TxRow } from '@/lib/transaction-rows';
import {
  groupFromFileName,
  readSplitwiseExport,
  SplitwiseExportError,
  type SplitwiseRow,
} from './export';
import { planImport, type Pair, type RememberedRow } from './match';
import type { ImportRecord, SplitwiseStore, TransactionSnapshot } from './store';

/** Category and merchant for a row about to be created, through your rules first. */
export type Categoriser = (
  row: SplitwiseRow,
  accountId: string
) => Promise<{ categoryId: string | null; confidence: number; merchant: string }>;

export type RunInput = {
  accountId: string;
  person: string;
  fileName: string;
  text: string;
  /** First import of a group only: rows dated before this YYYY-MM-DD are remembered as skipped. */
  skipBefore?: string;
};

/** Why a transaction is listed on the card. `category` is Splitwise's, shown under the description. */
export type RowNote = {
  transactionId: string;
  kind: 'new' | 'changed' | 'payment';
  /** Your previous Splitwise amount, on changed rows. */
  was?: number;
  cost: number;
  category: string;
  flag?: 'check-split' | 'deleted-check';
};

export type ImportCounts = {
  /** Every transaction created, payments included. */
  new: number;
  payments: number;
  /** Edits in Splitwise to rows with a live transaction, applied or flagged. */
  changed: number;
  /** Deletions in Splitwise of rows with a live transaction, applied or flagged. */
  deleted: number;
  unchanged: number;
  skippedByDate: number;
  others: number;
  otherCurrency: number;
  /** Rows you deleted yourself that are still in the file (M11). */
  ignored: number;
  needCategory: number;
};

export type DeletedRow = {
  rowId: string;
  date: string;
  description: string;
  amount: number;
  /** Your category name on the deleted transaction. */
  category: string | null;
  restored: boolean;
};

export type ImportResult = {
  importId: string;
  group: string;
  fileName: string;
  createdAt: string;
  firstImport: boolean;
  /** Whether this is the latest import of its account and group (M7). */
  canUndo: boolean;
  counts: ImportCounts;
  notes: RowNote[];
  /** The transactions the notes name, as they are now, newest first. */
  transactions: TxRow[];
  deleted: DeletedRow[];
  others: { date: string; description: string; cost: number }[];
  total: number;
};

/** P3: everything Undo needs to put the group back as it was before the import. */
export type ImportUndo = {
  rowsBefore: RememberedRow[];
  createdIds: string[];
  updated: { id: string; amount: number; date: string }[];
  deleted: TransactionSnapshot[];
};

/** The part of a result stored with the import; the rest is read back each time. */
export type StoredResult = Pick<
  ImportResult,
  'firstImport' | 'counts' | 'notes' | 'deleted' | 'others' | 'total'
>;

export class SplitwiseNotFoundError extends Error {}
/** Another import or undo of the same group got there first. */
export class SplitwiseConflictError extends Error {}
/** M7: only a group's latest import can be undone or restored from. */
export class SplitwiseUndoError extends Error {}

const PAYMENT_CATEGORY = 'Payment';
/** Large first imports write thousands of rows; Prisma's 5s default is too tight. */
const IMPORT_TIMEOUT_MS = 60_000;

/** A row that had a transaction (imported, or kept by Restore). */
const hadTransaction = (r: RememberedRow) => r.status === 'imported' || r.status === 'kept';

/** M11/R9: the row had a transaction and you have since deleted it. */
const isDeletedByYou = (r: RememberedRow) => hadTransaction(r) && r.transactionId === null;

/** The transaction an imported or kept row still links to, if any. */
const liveTransaction = (r: RememberedRow) => (hadTransaction(r) ? r.transactionId : null);

const fingerprintFields = (r: SplitwiseRow) => ({
  date: r.date,
  description: r.description,
  cost: r.cost,
  amount: r.amount,
});

const emptyCounts = (): ImportCounts => ({
  new: 0,
  payments: 0,
  changed: 0,
  deleted: 0,
  unchanged: 0,
  skippedByDate: 0,
  others: 0,
  otherCurrency: 0,
  ignored: 0,
  needCategory: 0,
});

type Creation = { row: SplitwiseRow } & Awaited<ReturnType<Categoriser>>;

/** What applying a plan did, built up as it goes. */
type Applied = { counts: ImportCounts; notes: RowNote[]; deleted: DeletedRow[]; undo: ImportUndo };

async function findImport(store: SplitwiseStore, importId: string): Promise<ImportRecord> {
  const record = await store.getImport(importId);
  if (!record) throw new SplitwiseNotFoundError(`No Splitwise import with id ${importId}.`);
  return record;
}

/** M7: whether this is its account and group's latest import. */
async function isLatest(store: SplitwiseStore, record: ImportRecord): Promise<boolean> {
  return (await store.latestImport(record.accountId, record.group))?.id === record.id;
}

/** M7: the import, refused unless it is its group's latest; `action` names what was refused. */
async function latestImportOrThrow(
  store: SplitwiseStore,
  importId: string,
  action: string
): Promise<ImportRecord> {
  const record = await findImport(store, importId);
  if (!(await isLatest(store, record))) {
    throw new SplitwiseUndoError(
      `Only the latest import of ${record.group} can be ${action}; this one has been imported over since.`
    );
  }
  return record;
}

/** A live row's transaction, for the undo record; without one, Undo couldn't put it back. */
async function snapshotOrThrow(
  store: SplitwiseStore,
  transactionId: string,
  row: RememberedRow
): Promise<TransactionSnapshot> {
  const snapshot = await store.snapshot(transactionId);
  if (!snapshot) {
    throw new SplitwiseConflictError(
      `The transaction for "${row.description}" (${row.date}) disappeared during the import. Import the file again.`
    );
  }
  return snapshot;
}

/** Applies Splitwise exports to one account (spec §2): all of an import or none of it. */
export class SplitwiseImporter {
  constructor(
    private readonly store: SplitwiseStore,
    private readonly categorise: Categoriser
  ) {}

  async run(input: RunInput): Promise<ImportResult> {
    const group = groupFromFileName(input.fileName);
    if (!group) {
      throw new SplitwiseExportError(
        `"${input.fileName}" isn't named like a Splitwise export (group_YYYY-MM-DD_export.csv). Use the file name Splitwise gave it.`
      );
    }
    const file = readSplitwiseExport(input.text, input.person);
    const account = await this.store.account(input.accountId);
    if (!account) throw new SplitwiseNotFoundError(`No account with id ${input.accountId}.`);
    const accountId = account.id;

    const firstImport = !(await this.store.knownGroup(accountId, group));
    const rowsBefore = await this.store.rows(accountId, group);
    const remembered = rowsBefore.map(
      (r): RememberedRow => (isDeletedByYou(r) ? { ...r, status: 'dismissed' } : r)
    );
    const plan = planImport(remembered, file.rows);

    // Decide each added row, categorising outside the write transaction: the categoriser reads
    // through its own client, and SQLite allows one writer.
    const counts = emptyCounts();
    const skipped: SplitwiseRow[] = [];
    const creations: Creation[] = [];
    for (const row of plan.added) {
      if (row.currency !== account.currency) counts.otherCurrency++;
      else if (firstImport && input.skipBefore && row.date < input.skipBefore) skipped.push(row);
      else if (row.category === PAYMENT_CATEGORY) {
        creations.push({ row, categoryId: null, confidence: 1, merchant: row.description });
      } else creations.push({ row, ...(await this.categorise(row, accountId)) });
    }

    return this.store.transaction(
      async (store) => {
        const current = await store.rows(accountId, group);
        if (JSON.stringify(current) !== JSON.stringify(rowsBefore)) {
          throw new SplitwiseConflictError(
            `Another import of ${group} ran at the same time. Import the file again.`
          );
        }
        const applied: Applied = {
          counts,
          notes: [],
          deleted: [],
          undo: { rowsBefore, createdIds: [], updated: [], deleted: [] },
        };
        for (const r of rowsBefore.filter(isDeletedByYou)) {
          await store.updateRow(r.id, { status: 'dismissed' });
        }
        for (const { row } of plan.unchanged) {
          if (row.status === 'dismissed') counts.ignored++;
          else counts.unchanged++;
        }
        for (const pair of plan.edited) await this.applyEdit(store, pair, applied);
        for (const creation of creations) {
          await this.create(store, accountId, group, creation, applied);
        }
        for (const row of skipped) {
          await store.createRow(accountId, group, {
            ...fingerprintFields(row),
            status: 'skipped',
            transactionId: null,
          });
          counts.skippedByDate++;
        }
        for (const row of plan.vanished) await this.applyDeletion(store, row, applied);

        counts.others = file.others.length;
        const result: StoredResult = {
          firstImport,
          counts,
          notes: applied.notes,
          deleted: applied.deleted,
          others: file.others.map((r) => ({
            date: r.date,
            description: r.description,
            cost: r.cost,
          })),
          total: file.total,
        };
        const record = await store.createImport({
          accountId,
          group,
          fileName: input.fileName,
          person: input.person,
          result,
          undo: applied.undo,
        });
        return this.toResult(store, record, true);
      },
      { timeoutMs: IMPORT_TIMEOUT_MS }
    );
  }

  async result(importId: string): Promise<ImportResult> {
    const record = await findImport(this.store, importId);
    return this.toResult(this.store, record, await isLatest(this.store, record));
  }

  /**
   * M6: brings back a transaction the import deleted, as it was, and keeps it from now on.
   * Latest import only, as for Undo, so a later Undo's remembered rows still line up.
   */
  async restore(importId: string, rowId: string): Promise<ImportResult> {
    return this.store.transaction(async (store) => {
      const record = await latestImportOrThrow(store, importId, 'restored from');
      const stored = record.result as StoredResult;
      const undo = record.undo as ImportUndo;
      const deleted = stored.deleted.find((d) => d.rowId === rowId);
      const row = undo.rowsBefore.find((r) => r.id === rowId);
      const snapshot = row && undo.deleted.find((t) => t.id === row.transactionId);
      if (!deleted || !row || !snapshot) {
        throw new SplitwiseNotFoundError(`Import ${importId} deleted no row ${rowId}.`);
      }
      if (deleted.restored) return this.toResult(store, record, true);

      await store.recreate(snapshot);
      await store.createRow(record.accountId, record.group, {
        ...row,
        status: 'kept',
        transactionId: snapshot.id,
      });
      const result: StoredResult = {
        ...stored,
        deleted: stored.deleted.map((d) => (d.rowId === rowId ? { ...d, restored: true } : d)),
      };
      await store.updateImportResult(record.id, result);
      return this.toResult(store, { ...record, result }, true);
    });
  }

  /**
   * M7: puts the group back as it was before its latest import and forgets that import. Edits
   * you made since to what it created are lost; a transaction you deleted since stays deleted.
   */
  async undo(importId: string): Promise<void> {
    await this.store.transaction(
      async (store) => {
        const record = await latestImportOrThrow(store, importId, 'undone');
        const undo = record.undo as ImportUndo;
        const restoredRows = new Set(
          (record.result as StoredResult).deleted.filter((d) => d.restored).map((d) => d.rowId)
        );
        const restored = new Set(
          undo.rowsBefore.filter((r) => restoredRows.has(r.id)).map((r) => r.transactionId)
        );

        const present = await store.existingTransactionIds([
          ...undo.createdIds,
          ...undo.updated.map((u) => u.id),
        ]);
        for (const id of undo.createdIds) {
          if (present.has(id)) await store.deleteTransaction(id);
        }
        for (const { id, amount, date } of undo.updated) {
          if (present.has(id)) await store.updateTransaction(id, { amount, date: new Date(date) });
        }
        for (const snapshot of undo.deleted) {
          if (!restored.has(snapshot.id)) await store.recreate(snapshot);
        }

        // A transaction you deleted since leaves its row unlinked: deleted by you (P2).
        const live = await store.existingTransactionIds(
          undo.rowsBefore.flatMap((r) => (r.transactionId ? [r.transactionId] : []))
        );
        await store.replaceRows(
          record.accountId,
          record.group,
          undo.rowsBefore.map((r) =>
            r.transactionId && !live.has(r.transactionId) ? { ...r, transactionId: null } : r
          )
        );
        await store.deleteImport(record.id);
      },
      { timeoutMs: IMPORT_TIMEOUT_MS }
    );
  }

  /** P6: the last import's account and name; with none, the Splitwise account and no name. */
  async defaults(): Promise<{ accountId: string | null; person: string; knownGroups: string[] }> {
    const latest = await this.store.latestImportAny();
    const accountId = latest?.accountId ?? (await this.store.splitwiseAccount())?.id ?? null;
    return {
      accountId,
      person: latest?.person ?? '',
      knownGroups: accountId ? await this.store.groups(accountId) : [],
    };
  }

  isKnown(accountId: string, group: string): Promise<boolean> {
    return this.store.knownGroup(accountId, group);
  }

  /** M5: Splitwise wins on amount and date, unless you've reshaped the transaction. */
  private async applyEdit(store: SplitwiseStore, { row, incoming }: Pair, applied: Applied) {
    const transactionId = liveTransaction(row);
    if (row.status === 'dismissed') applied.counts.ignored++;
    if (transactionId) {
      applied.counts.changed++;
      const note: RowNote = {
        transactionId,
        kind: 'changed',
        was: row.amount,
        cost: incoming.cost,
        category: incoming.category,
      };
      if (await store.isReshaped(transactionId)) {
        applied.notes.push({ ...note, flag: 'check-split' });
      } else {
        const before = await snapshotOrThrow(store, transactionId, row);
        applied.undo.updated.push({ id: before.id, amount: before.amount, date: before.date });
        await store.updateTransaction(transactionId, {
          amount: incoming.amount,
          date: utcDay(incoming.date),
        });
        applied.notes.push(note);
      }
    }
    await store.updateRow(row.id, fingerprintFields(incoming));
  }

  private async create(
    store: SplitwiseStore,
    accountId: string,
    group: string,
    { row, categoryId, confidence, merchant }: Creation,
    applied: Applied
  ) {
    const date = utcDay(row.date);
    const isPayment = row.category === PAYMENT_CATEGORY;
    const tx = await store.createTransaction({
      date,
      amount: row.amount,
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      accountId,
      categoryId,
      confidenceScore: confidence,
      isTransfer: isPayment,
      tags: '[]',
      importHash: createImportHash(accountId, date, row.amount, normalizeMerchant(row.description)),
    });
    await store.createRow(accountId, group, {
      ...fingerprintFields(row),
      status: 'imported',
      transactionId: tx.id,
    });
    applied.undo.createdIds.push(tx.id);
    applied.counts.new++;
    if (isPayment) applied.counts.payments++;
    else if (!categoryId) applied.counts.needCategory++;
    applied.notes.push({
      transactionId: tx.id,
      kind: isPayment ? 'payment' : 'new',
      cost: row.cost,
      category: row.category,
    });
  }

  /**
   * Deleted in Splitwise: plain transactions go (with a snapshot), reshaped ones are flagged
   * (M10). A kept row stays remembered (M6), so it matches if Splitwise brings it back.
   */
  private async applyDeletion(store: SplitwiseStore, row: RememberedRow, applied: Applied) {
    if (row.status === 'kept') return;
    const transactionId = liveTransaction(row);
    if (!transactionId) return store.deleteRow(row.id);

    applied.counts.deleted++;
    if (await store.isReshaped(transactionId)) {
      // Remembered rows don't keep Splitwise's category, so this note has none.
      applied.notes.push({
        transactionId,
        kind: 'changed',
        cost: row.cost,
        category: '',
        flag: 'deleted-check',
      });
      return;
    }
    const snapshot = await snapshotOrThrow(store, transactionId, row);
    const [tx] = await store.getTransactions([transactionId]);
    applied.undo.deleted.push(snapshot);
    applied.deleted.push({
      rowId: row.id,
      date: row.date,
      description: row.description,
      amount: tx.amount,
      category: tx.category?.name ?? null,
      restored: false,
    });
    await store.deleteTransaction(transactionId);
    await store.deleteRow(row.id);
  }

  private async toResult(
    store: SplitwiseStore,
    record: ImportRecord,
    canUndo: boolean
  ): Promise<ImportResult> {
    const stored = record.result as StoredResult;
    const ids = [...new Set(stored.notes.map((n) => n.transactionId))];
    const transactions = (await store.getTransactions(ids)).sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );
    return {
      ...stored,
      importId: record.id,
      group: record.group,
      fileName: record.fileName,
      createdAt: record.createdAt.toISOString(),
      canUndo,
      transactions,
    };
  }
}
