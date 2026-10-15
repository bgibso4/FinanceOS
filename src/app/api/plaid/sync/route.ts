import { getInvestmentServices } from '@/lib/investments/services';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { syncPlaidTransactions, type SyncResult, type DryRunResult } from '@/lib/plaid-sync';
import {
  syncPlaidInvestments,
  type InvestmentSyncResult,
} from '@/lib/investments/plaid-investment-sync';
import { ensureStoredCodes } from '@/lib/investments/rename-stored-codes';
import { recordInvestmentSyncStatus } from '@/lib/investments/sync-status';
import { withSyncLock } from '@/lib/sync-common';
import { classifyPlaidError } from '@/lib/bank-errors';

const schema = z.object({
  accountId: z.string(),
  daysToSync: z.number().optional().default(30),
  dryRun: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  // Hoisted so the catch block can persist re-auth status. The old code
  // re-read `await req.json()` in the catch, but the body stream was already
  // consumed, so it silently resolved to `{}` and never marked the connection.
  let accountId: string | undefined;
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    accountId = parsed.accountId;
    const { daysToSync, dryRun } = parsed;

    const connection = await prisma.plaidConnection.findUnique({
      where: { accountId },
      include: {
        account: true,
        plaidEnrollment: true,
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Plaid connection found for this account' },
        { status: 404 }
      );
    }

    if (connection.status === 'needs_reauth') {
      return NextResponse.json(
        { error: 'Account requires re-authentication', code: 'NEEDS_REAUTH' },
        { status: 400 }
      );
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
    const investmentAccountIds = investmentConnections.map((c) => c.accountId);
    const cashFlowConnection = isInvestment(connection)
      ? itemConnections.find((c) => !isInvestment(c))
      : connection;

    const base = {
      success: true,
      dryRun,
      investment: isInvestment(connection),
      investmentAccountIds,
    };

    if (dryRun) {
      // Dry runs are read-only, so no lock. Investment syncs have no preview; Sync All treats
      // the listed investment accounts as always syncable.
      const result = cashFlowConnection
        ? await syncPlaidTransactions(cashFlowConnection, { daysToSync, dryRun })
        : emptyPreview(investmentConnections, daysToSync);
      return NextResponse.json({ ...base, ...result });
    }

    // Serialize real syncs by enrollment: Plaid's transactionsSync cursor is shared across all
    // sibling accounts under one item, and the investment sync uses the same item token.
    // Re-auth errors propagate to the catch below.
    // Investment code reads and writes the neutral stored codes; rename any old ones first.
    // Bank-only items skip it, so a failed rename never blocks a transactions sync.
    if (investmentConnections.length) await ensureStoredCodes(prisma);
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

    if (investments.length) {
      // Pricing is one throttled Yahoo call per stale symbol: run it after responding, never
      // failing the sync. The investments view's refresh call covers anything missed.
      void getInvestmentServices()
        .then(({ refresh }) => refresh.refresh())
        .catch((error) => console.error('[investments] post-sync refresh failed:', error));
    }

    return NextResponse.json({ ...base, ...result, investments });
  } catch (error: unknown) {
    const { needsReauth, code, reason } = classifyPlaidError(error);

    if (needsReauth) {
      // Expected lifecycle state (stale bank session) — log concisely rather
      // than dumping the multi-KB AxiosError, and persist so the account shows
      // "Needs Reconnection".
      console.warn(`Plaid sync needs reconnection${code ? ` (${code})` : ''}: ${reason}`);
      if (accountId) {
        await prisma.plaidConnection
          .update({
            where: { accountId },
            data: { status: 'needs_reauth', lastSyncStatus: 'error', lastSyncError: reason },
          })
          .catch((e) => console.error('Failed to update connection status:', e));
      }
      return NextResponse.json(
        { error: 'Bank login required', code: 'NEEDS_REAUTH' },
        { status: 400 }
      );
    }

    console.error('Error syncing transactions:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync transactions';
    return NextResponse.json({ error: message }, { status: 500 });
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
