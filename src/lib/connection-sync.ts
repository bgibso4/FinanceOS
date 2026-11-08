/**
 * One sync function per bank connection. The Sync buttons, "Sync all" and the scheduled pass all
 * run these, so locking, re-login status and the response shape live in one place. The routes
 * only parse input and map ConnectionSyncError to HTTP.
 */
import { prisma } from '@/lib/prisma';
import { syncPlaidTransactions, type SyncResult, type DryRunResult } from '@/lib/plaid-sync';
import { syncTellerTransactions } from '@/lib/teller-sync';
import {
  syncPlaidInvestments,
  type InvestmentSyncResult,
} from '@/lib/investments/plaid-investment-sync';
import { ensureStoredCodes } from '@/lib/investments/rename-stored-codes';
import { recordInvestmentSyncStatus } from '@/lib/investments/sync-status';
import { withSyncLock } from '@/lib/sync-common';
import { classifyPlaidError, classifyTellerError } from '@/lib/bank-errors';

export type ConnectionSyncErrorCode =
  | 'NOT_FOUND'
  | 'NEEDS_REAUTH'
  | 'DISCONNECTED'
  | 'AUTH_EXPIRED';

/** A sync that failed for a reason the caller can act on (no connection, login needed). */
export class ConnectionSyncError extends Error {
  constructor(
    readonly code: ConnectionSyncErrorCode,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ConnectionSyncError';
  }

  /** True when the fix is to log in to the bank again; every code but a missing connection. */
  get needsRelogin(): boolean {
    return this.code !== 'NOT_FOUND';
  }

  /** The routes' JSON body. Only re-login states carry a code; a missing connection is bare. */
  get body(): { error: string; code?: ConnectionSyncErrorCode } {
    return this.needsRelogin ? { error: this.message, code: this.code } : { error: this.message };
  }
}

export type PlaidSyncOutcome = {
  success: true;
  dryRun: boolean;
  investment: boolean;
  investmentAccountIds: string[];
  investments?: InvestmentSyncResult[];
} & (SyncResult | DryRunResult);

export type TellerSyncOutcome = {
  success: true;
  dryRun: boolean;
} & Awaited<ReturnType<typeof syncTellerTransactions>>;

export async function syncPlaidConnection(
  accountId: string,
  opts: { daysToSync: number; dryRun?: boolean }
): Promise<PlaidSyncOutcome> {
  const { daysToSync, dryRun = false } = opts;
  try {
    const connection = await prisma.plaidConnection.findUnique({
      where: { accountId },
      include: { account: true, plaidEnrollment: true },
    });
    if (!connection) {
      throw new ConnectionSyncError('NOT_FOUND', 404, 'No Plaid connection found for this account');
    }
    if (connection.status === 'needs_reauth') {
      throw new ConnectionSyncError('NEEDS_REAUTH', 400, 'Account requires re-authentication');
    }

    // One Plaid item can hold both kinds of account. Investment-mode connections each run the
    // investment sync; the item's cash-flow connections share one transaction sync, run only
    // when the item has any (Plaid's cursor covers them all whichever account is asked for).
    const itemConnections = await prisma.plaidConnection.findMany({
      where: {
        plaidEnrollmentId: connection.plaidEnrollmentId,
        OR: [{ status: 'connected' }, { id: connection.id }],
      },
      include: { account: true, plaidEnrollment: true },
      orderBy: { createdAt: 'asc' },
    });
    const isInvestment = (c: { account: { trackingMode: string } }) =>
      c.account.trackingMode === 'investment';
    const investmentConnections = itemConnections.filter(isInvestment);
    const cashFlowConnection = isInvestment(connection)
      ? itemConnections.find((c) => !isInvestment(c))
      : connection;

    const base = {
      success: true as const,
      dryRun,
      investment: isInvestment(connection),
      investmentAccountIds: investmentConnections.map((c) => c.accountId),
    };

    if (dryRun) {
      // Dry runs are read-only, so no lock. Investment syncs have no preview; Sync All treats
      // the listed investment accounts as always syncable.
      const result = cashFlowConnection
        ? await syncPlaidTransactions(cashFlowConnection, { daysToSync, dryRun })
        : emptyPreview(investmentConnections, daysToSync);
      return { ...base, ...result };
    }

    // Investment code reads and writes the neutral stored codes; rename any old ones first.
    // Bank-only items skip it, so a failed rename never blocks a transactions sync.
    if (investmentConnections.length) await ensureStoredCodes(prisma);
    // Serialize real syncs by enrollment: Plaid's transactionsSync cursor is shared across all
    // sibling accounts under one item, and the investment sync uses the same item token.
    const { result, investments } = await withSyncLock(
      `plaid:${connection.plaidEnrollment.id}`,
      async () => {
        const result = cashFlowConnection
          ? await syncPlaidTransactions(cashFlowConnection, { daysToSync })
          : emptyStats();
        const investments: InvestmentSyncResult[] = [];
        for (const c of investmentConnections) {
          const r = await syncPlaidInvestments(c);
          await recordInvestmentSyncStatus(prisma, r);
          investments.push(r);
        }
        return { result, investments };
      }
    );
    return { ...base, ...result, investments };
  } catch (error: unknown) {
    if (error instanceof ConnectionSyncError) throw error;
    const { needsReauth, code, reason } = classifyPlaidError(error);
    if (!needsReauth) throw error;

    // Expected lifecycle state (stale bank session): log concisely rather than dumping the
    // multi-KB AxiosError, and persist so the account shows "Needs Reconnection".
    console.warn(`Plaid sync needs reconnection${code ? ` (${code})` : ''}: ${reason}`);
    await prisma.plaidConnection
      .update({
        where: { accountId },
        data: { status: 'needs_reauth', lastSyncStatus: 'error', lastSyncError: reason },
      })
      .catch((e) => console.error('Failed to update connection status:', e));
    throw new ConnectionSyncError('NEEDS_REAUTH', 400, 'Bank login required');
  }
}

export async function syncTellerConnection(
  accountId: string,
  opts: { daysToSync: number; includePending?: boolean; dryRun?: boolean }
): Promise<TellerSyncOutcome> {
  const { daysToSync, includePending = false, dryRun = false } = opts;
  const connection = await prisma.tellerConnection.findUnique({
    where: { accountId },
    include: { account: true, tellerEnrollment: true },
  });
  if (!connection) {
    throw new ConnectionSyncError('NOT_FOUND', 404, 'No Teller connection found for this account');
  }
  if (connection.status === 'disconnected') {
    throw new ConnectionSyncError(
      'DISCONNECTED',
      400,
      'Account is disconnected. Please reconnect.'
    );
  }

  try {
    const runSync = () =>
      syncTellerTransactions(connection, { daysToSync, includePending, dryRun });
    // Serialize real syncs of the same account so two concurrent runs can't interleave their
    // dedup checks and writes. Dry runs are read-only, so they don't need the lock.
    const result = dryRun ? await runSync() : await withSyncLock(`teller:${accountId}`, runSync);
    return { success: true, dryRun, ...result };
  } catch (error: unknown) {
    // Teller's verbatim "Enrollment is not healthy" (password change, MFA expiry, OAuth revoke)
    // and similar mean the user must reconnect through Teller Connect.
    const { needsReauth, reason } = classifyTellerError(error);
    if (!needsReauth) throw error;

    const message = reason || 'Reconnection required.';
    try {
      await prisma.tellerConnection.update({
        where: { accountId },
        data: { status: 'disconnected', lastSyncStatus: 'error', lastSyncError: message },
      });
      await prisma.tellerEnrollment.update({
        where: { id: connection.tellerEnrollmentId },
        data: { status: 'disconnected' },
      });
    } catch (updateError) {
      console.error('Failed to update disconnected status:', updateError);
    }
    throw new ConnectionSyncError('AUTH_EXPIRED', 400, message);
  }
}

function emptyStats(accounts: { accountId: string; account: { name: string } }[] = []): SyncResult {
  return {
    added: 0,
    modified: 0,
    removed: 0,
    skippedDuplicates: 0,
    skippedOld: 0,
    autoCategorized: 0,
    merged: 0,
    transfersDetected: 0,
    byAccount: accounts.map((c) => ({
      accountId: c.accountId,
      accountName: c.account.name,
      added: 0,
      merged: 0,
      modified: 0,
      removed: 0,
      skippedDuplicates: 0,
    })),
    historyComplete: true,
    oldestTransactionDate: null,
  };
}

/** Preview for an item with only investment accounts: nothing to import as transactions. */
function emptyPreview(
  accounts: { accountId: string; account: { name: string } }[],
  daysToSync: number
): DryRunResult {
  const to = new Date();
  const from = new Date(to.getTime() - daysToSync * 24 * 60 * 60 * 1000);
  return {
    stats: emptyStats(accounts),
    transactions: [],
    dateRange: { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] },
    totalFetched: 0,
  };
}
