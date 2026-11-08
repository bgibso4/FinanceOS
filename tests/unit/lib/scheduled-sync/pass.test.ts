import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import { fixedClock } from '@/lib/clock';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/plaid-sync', () => ({ syncPlaidTransactions: vi.fn() }));
vi.mock('@/lib/teller-sync', () => ({ syncTellerTransactions: vi.fn() }));
const refresh = vi.fn(async () => ({}));
const fill = vi.fn(async () => ({ pairs: [], days: 0, failed: [] as string[] }));
vi.mock('@/lib/investments/services', () => ({
  getInvestmentServices: async () => ({ fxRates: { fill }, refresh: { refresh } }),
}));

import { runSyncPass, defaultPassDeps } from '@/lib/scheduled-sync/pass';
import { readPassRecord } from '@/lib/scheduled-sync/record';
import { syncPlaidConnection } from '@/lib/connection-sync';
import { syncPlaidTransactions } from '@/lib/plaid-sync';

const clock = fixedClock('2026-11-08T12:00:00Z');

async function tellerAccount(name: string, status = 'connected') {
  const a = await testPrisma.account.create({
    data: createAccountData({ name, type: 'checking' }),
  });
  const e = await testPrisma.tellerEnrollment.create({
    data: {
      enrollmentId: `te-${name}`,
      institutionId: 'x',
      institutionName: 'X',
      accessTokenEncrypted: 'x',
      accessTokenIv: 'y',
    },
  });
  await testPrisma.tellerConnection.create({
    data: { accountId: a.id, tellerEnrollmentId: e.id, tellerAccountId: `ta-${name}`, status },
  });
  return a;
}

describe('runSyncPass', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
  });

  const deps = (over: Record<string, unknown> = {}) => ({
    prisma: testPrisma,
    fillRates: async () => ({ failed: [] }),
    syncUnit: async () => {},
    refreshPrices: async () => ({}),
    clock,
    ...over,
  });

  it('stepsRunInOrder', async () => {
    await tellerAccount('a');
    const order: string[] = [];
    const s = await runSyncPass(
      deps({
        fillRates: async () => (order.push('rates'), { failed: [] }),
        syncUnit: async () => void order.push('accounts'),
        refreshPrices: async () => order.push('prices'),
      })
    );
    expect(order).toEqual(['rates', 'accounts', 'prices']);
    expect(s.failures).toEqual([]);
    expect((await readPassRecord(testPrisma))?.finishedAt).toEqual(clock.now());
  });

  it('oneFailingConnectionDoesNotStopOthers', async () => {
    await tellerAccount('a');
    await tellerAccount('b');
    const seen: string[] = [];
    const s = await runSyncPass(
      deps({
        syncUnit: async (u: { entryAccountId: string }) => {
          seen.push(u.entryAccountId);
          if (seen.length === 1) throw new Error('boom');
        },
      })
    );
    expect(seen).toHaveLength(2);
    expect(s.failures).toEqual(['accounts']);
    expect(s.units.map((u) => u.ok).sort()).toEqual([false, true]);
    expect(s.units.find((u) => !u.ok)?.error).toBe('boom');
  });

  it('failedRatesAndPricesAreRecordedAndDoNotStopAccounts', async () => {
    await tellerAccount('a');
    const syncUnit = vi.fn(async () => {});
    const s = await runSyncPass(
      deps({
        fillRates: async () => ({ failed: ['CAD->USD'] }),
        refreshPrices: async () => {
          throw new Error('down');
        },
        syncUnit,
      })
    );
    expect(syncUnit).toHaveBeenCalledTimes(1);
    expect(s.failures).toEqual(['rates', 'prices']);
    expect((await readPassRecord(testPrisma))?.failures).toEqual(['rates', 'prices']);
  });

  it('reloginConnectionsAreSkipped', async () => {
    await tellerAccount('ok');
    await tellerAccount('gone', 'disconnected');
    const syncUnit = vi.fn(async () => {});
    await runSyncPass(deps({ syncUnit }));
    expect(syncUnit).toHaveBeenCalledTimes(1);
  });

  it('pricesRefreshOncePerPass', async () => {
    await tellerAccount('a');
    await tellerAccount('b');
    const refreshPrices = vi.fn(async () => ({}));
    await runSyncPass(deps({ refreshPrices }));
    expect(refreshPrices).toHaveBeenCalledTimes(1);
  });

  it('recordWrittenOnlyWhenPassFinishes', async () => {
    const old = { finishedAt: new Date('2026-11-01T00:00:00Z'), failures: [], units: [] };
    const { writePassRecord } = await import('@/lib/scheduled-sync/record');
    await writePassRecord(testPrisma, old);
    const broken = { ...deps(), prisma: undefined };
    await expect(runSyncPass(broken as never)).rejects.toThrow();
    expect((await readPassRecord(testPrisma))?.finishedAt).toEqual(old.finishedAt);
  });

  it('passAndRouteShareTheLock', async () => {
    const a = await testPrisma.account.create({ data: createAccountData({ type: 'checking' }) });
    const e = await testPrisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item-1',
        institutionName: 'Bank',
        accessTokenEncrypted: 'x',
        accessTokenIv: 'y',
      },
    });
    await testPrisma.plaidConnection.create({
      data: {
        accountId: a.id,
        plaidEnrollmentId: e.id,
        plaidAccountId: 'pa-1',
        plaidAccountType: 'depository',
      },
    });
    const log: string[] = [];
    let n = 0;
    vi.mocked(syncPlaidTransactions).mockImplementation((async () => {
      const id = ++n;
      log.push(`enter${id}`);
      await new Promise((r) => setTimeout(r, 30));
      log.push(`exit${id}`);
      return { added: 0, merged: 0, skippedDuplicates: 0 };
    }) as never);

    const real = await defaultPassDeps();
    const pass = runSyncPass({ ...real, prisma: testPrisma, clock });
    await vi.waitFor(() => expect(log).toContain('enter1'));
    const click = syncPlaidConnection(a.id, { daysToSync: 30 });
    await Promise.all([pass, click]);
    expect(log).toEqual(['enter1', 'exit1', 'enter2', 'exit2']);
  });
});
