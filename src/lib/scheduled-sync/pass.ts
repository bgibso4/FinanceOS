/**
 * One scheduled sync pass: daily rates, then every syncable connection, then prices, then the
 * record. Each step is injected and isolated, so one failing step never stops the next.
 */
import type { PrismaClient } from '@prisma/client';
import { syncUnits, isSyncableAccount, type SyncUnit } from '@/lib/sync-grouping';
import {
  ConnectionSyncError,
  syncPlaidConnection,
  syncTellerConnection,
} from '@/lib/connection-sync';
import { systemClock, type Clock } from '@/lib/clock';
import { writePassRecord } from './record';

export type PassStep = 'rates' | 'accounts' | 'prices';

export type PassSummary = {
  finishedAt: Date;
  failures: PassStep[];
  /** needsRelogin: the connection's own status shows it, so it is not an 'accounts' failure. */
  units: { entryAccountId: string; ok: boolean; error?: string; needsRelogin?: boolean }[];
};

export type PassDeps = {
  prisma: PrismaClient;
  fillRates(): Promise<{ failed: string[] }>;
  syncUnit(u: SyncUnit): Promise<void>;
  refreshPrices(): Promise<unknown>;
  clock?: Clock;
};

const SYNC_DAYS = 30;

export async function runSyncPass(deps: PassDeps): Promise<PassSummary> {
  const failures: PassStep[] = [];
  const units: PassSummary['units'] = [];

  try {
    const { failed } = await deps.fillRates();
    if (failed.length > 0) failures.push('rates');
  } catch (error) {
    console.warn('Scheduled sync: rates failed:', error);
    failures.push('rates');
  }

  try {
    const accounts = await deps.prisma.account.findMany({
      where: { isActive: true },
      include: { tellerConnection: true, plaidConnection: true },
    });
    for (const unit of syncUnits(accounts.filter(isSyncableAccount))) {
      try {
        await deps.syncUnit(unit);
        units.push({ entryAccountId: unit.entryAccountId, ok: true });
      } catch (error) {
        console.warn(`Scheduled sync: ${unit.entryAccountId} failed:`, error);
        units.push({
          entryAccountId: unit.entryAccountId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof ConnectionSyncError && error.needsRelogin && { needsRelogin: true }),
        });
      }
    }
    if (units.some((u) => !u.ok && !u.needsRelogin)) failures.push('accounts');
  } catch (error) {
    console.warn('Scheduled sync: accounts failed:', error);
    failures.push('accounts');
  }

  try {
    await deps.refreshPrices();
  } catch (error) {
    console.warn('Scheduled sync: prices failed:', error);
    failures.push('prices');
  }

  const summary: PassSummary = {
    finishedAt: (deps.clock ?? systemClock).now(),
    failures,
    units,
  };
  await writePassRecord(deps.prisma, summary);
  return summary;
}

/** The real steps: 30 days of bank history, no preview. */
export async function defaultPassDeps(): Promise<PassDeps> {
  const { prisma } = await import('@/lib/prisma');
  const { getInvestmentServices } = await import('@/lib/investments/services');
  const { fxRates, refresh } = await getInvestmentServices();
  return {
    prisma,
    fillRates: () => fxRates.fill(),
    syncUnit: async (u) => {
      const sync = u.provider === 'plaid' ? syncPlaidConnection : syncTellerConnection;
      await sync(u.entryAccountId, { daysToSync: SYNC_DAYS });
    },
    refreshPrices: () => refresh.refresh(),
  };
}
