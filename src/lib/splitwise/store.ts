import type { Prisma, PrismaClient, Transaction } from '@prisma/client';
import { cleanupTransferPair } from '@/lib/sync-common';
import { TX_ROW_INCLUDE, toTxRow, type TxRow } from '@/lib/transaction-rows';
import type { RememberedRow, RowStatus } from './match';

type Db = PrismaClient | Prisma.TransactionClient;

/** One import as stored; `result` and `undo` are the importer's JSON, parsed. */
export type ImportRecord = {
  id: string;
  accountId: string;
  group: string;
  fileName: string;
  person: string;
  result: unknown;
  undo: unknown;
  createdAt: Date;
};

export type NewImport = Omit<ImportRecord, 'id' | 'createdAt'>;

/** Every scalar field of a transaction, JSON-safe, so it can be recreated with the same id. */
export type TransactionSnapshot = Omit<Transaction, 'date' | 'createdAt'> & {
  date: string;
  createdAt: string;
};

export type AccountRef = { id: string; currency: string };

const SPLITWISE_INSTITUTION = 'Splitwise';
const ACCOUNT_REF = { id: true, currency: true } as const;

const toRemembered = (r: {
  id: string;
  date: string;
  description: string;
  cost: number;
  amount: number;
  status: string;
  transactionId: string | null;
}): RememberedRow => ({
  id: r.id,
  date: r.date,
  description: r.description,
  cost: r.cost,
  amount: r.amount,
  status: r.status as RowStatus,
  transactionId: r.transactionId,
});

const toImport = (r: Prisma.SplitwiseImportGetPayload<object>): ImportRecord => ({
  ...r,
  result: JSON.parse(r.result),
  undo: JSON.parse(r.undo),
});

/**
 * The only code that touches the SplitwiseImport and SplitwiseRow tables, and the only
 * transaction writes the Splitwise import makes.
 */
export class SplitwiseStore {
  constructor(private readonly db: Db) {}

  /**
   * Runs `fn` with a store bound to one interactive transaction: all of its writes or none.
   * Inside a transaction already, `fn` joins it. `timeoutMs` overrides Prisma's 5s default.
   */
  async transaction<T>(
    fn: (store: SplitwiseStore) => Promise<T>,
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    if (!('$transaction' in this.db)) return fn(this);
    return this.db.$transaction((tx) => fn(this.bind(tx)), { timeout: options.timeoutMs });
  }

  /** The store `transaction` hands to its callback. */
  protected bind(tx: Prisma.TransactionClient): SplitwiseStore {
    return new SplitwiseStore(tx);
  }

  // Remembered rows

  async rows(accountId: string, group: string): Promise<RememberedRow[]> {
    const rows = await this.db.splitwiseRow.findMany({
      where: { accountId, group },
      orderBy: { id: 'asc' },
    });
    return rows.map(toRemembered);
  }

  /** Replaces the group's remembered rows with `rows`, keeping their ids. */
  async replaceRows(accountId: string, group: string, rows: RememberedRow[]): Promise<void> {
    await this.db.splitwiseRow.deleteMany({ where: { accountId, group } });
    await this.db.splitwiseRow.createMany({
      data: rows.map((r) => ({ ...r, accountId, group })),
    });
  }

  /** Creates a remembered row, with the given id when there is one. */
  async createRow(
    accountId: string,
    group: string,
    row: Omit<RememberedRow, 'id'> & { id?: string }
  ): Promise<RememberedRow> {
    return toRemembered(await this.db.splitwiseRow.create({ data: { ...row, accountId, group } }));
  }

  async updateRow(id: string, patch: Partial<Omit<RememberedRow, 'id'>>): Promise<void> {
    await this.db.splitwiseRow.update({ where: { id }, data: patch });
  }

  async deleteRow(id: string): Promise<void> {
    await this.db.splitwiseRow.delete({ where: { id } });
  }

  // Imports

  async latestImport(accountId: string, group: string): Promise<ImportRecord | null> {
    const row = await this.db.splitwiseImport.findFirst({
      where: { accountId, group },
      orderBy: { createdAt: 'desc' },
    });
    return row && toImport(row);
  }

  async latestImportAny(): Promise<ImportRecord | null> {
    const row = await this.db.splitwiseImport.findFirst({ orderBy: { createdAt: 'desc' } });
    return row && toImport(row);
  }

  async createImport(input: NewImport): Promise<ImportRecord> {
    return toImport(
      await this.db.splitwiseImport.create({
        data: { ...input, result: JSON.stringify(input.result), undo: JSON.stringify(input.undo) },
      })
    );
  }

  async getImport(id: string): Promise<ImportRecord | null> {
    const row = await this.db.splitwiseImport.findUnique({ where: { id } });
    return row && toImport(row);
  }

  async deleteImport(id: string): Promise<void> {
    await this.db.splitwiseImport.delete({ where: { id } });
  }

  async updateImportResult(id: string, result: unknown): Promise<void> {
    await this.db.splitwiseImport.update({
      where: { id },
      data: { result: JSON.stringify(result) },
    });
  }

  /** The groups imported into the account, by name. */
  async groups(accountId: string): Promise<string[]> {
    const rows = await this.db.splitwiseImport.findMany({
      where: { accountId },
      distinct: ['group'],
      select: { group: true },
      orderBy: { group: 'asc' },
    });
    return rows.map((r) => r.group);
  }

  /** Whether the group has been imported into the account before. */
  async knownGroup(accountId: string, group: string): Promise<boolean> {
    return !!(await this.db.splitwiseImport.findFirst({
      where: { accountId, group },
      select: { id: true },
    }));
  }

  // Transactions

  async createTransaction(data: Prisma.TransactionUncheckedCreateInput): Promise<Transaction> {
    return this.db.transaction.create({ data });
  }

  async updateTransaction(
    id: string,
    data: Prisma.TransactionUncheckedUpdateInput
  ): Promise<Transaction> {
    return this.db.transaction.update({ where: { id }, data });
  }

  /** Deletes a transaction, first releasing its transfer partner as the delete route does. */
  async deleteTransaction(id: string): Promise<void> {
    await cleanupTransferPair(id, this.db);
    await this.db.transaction.delete({ where: { id } });
  }

  async getTransactions(ids: string[]): Promise<TxRow[]> {
    const rows = await this.db.transaction.findMany({
      where: { id: { in: ids } },
      include: TX_ROW_INCLUDE,
    });
    return rows.map(toTxRow);
  }

  async snapshot(id: string): Promise<TransactionSnapshot | null> {
    const tx = await this.db.transaction.findUnique({ where: { id } });
    return tx && { ...tx, date: tx.date.toISOString(), createdAt: tx.createdAt.toISOString() };
  }

  /**
   * Recreates a snapshotted transaction with its original id. A category or trip deleted since
   * the snapshot is left off rather than failing the recreate.
   */
  async recreate(snapshot: TransactionSnapshot): Promise<Transaction> {
    const category =
      snapshot.categoryId &&
      (await this.db.category.findUnique({ where: { id: snapshot.categoryId } }));
    const trip =
      snapshot.tripId && (await this.db.trip.findUnique({ where: { id: snapshot.tripId } }));
    return this.db.transaction.create({
      data: {
        ...snapshot,
        categoryId: category ? category.id : null,
        tripId: trip ? trip.id : null,
        date: new Date(snapshot.date),
        createdAt: new Date(snapshot.createdAt),
      },
    });
  }

  /** Which of `ids` are transactions that exist. */
  async existingTransactionIds(ids: string[]): Promise<Set<string>> {
    const rows = await this.db.transaction.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** P4: split, part of a transfer, linked to another transaction, or offset by others. */
  async isReshaped(id: string): Promise<boolean> {
    const tx = await this.db.transaction.findUnique({
      where: { id },
      select: {
        isSplitParent: true,
        transferGroupId: true,
        linkedTransactionId: true,
        _count: { select: { offsetTransactions: true } },
      },
    });
    return (
      !!tx &&
      (tx.isSplitParent ||
        !!tx.transferGroupId ||
        !!tx.linkedTransactionId ||
        tx._count.offsetTransactions > 0)
    );
  }

  // Accounts

  async account(id: string): Promise<AccountRef | null> {
    return this.db.account.findUnique({ where: { id }, select: ACCOUNT_REF });
  }

  /** P6: the active account whose institution is Splitwise. */
  async splitwiseAccount(): Promise<AccountRef | null> {
    return this.db.account.findFirst({
      where: { institution: SPLITWISE_INSTITUTION, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: ACCOUNT_REF,
    });
  }
}
