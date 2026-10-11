import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedInvestmentAccount,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../../helpers/investments';

let prisma: PrismaClient;

describe('InvestmentRefreshService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('prices securities, then values valued accounts', async () => {
    const valued = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: valued.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 2,
      price: 0,
      source: 'manual',
    });
    const { services } = testServices(prisma, { closes: { AAA: { '2026-10-09': 15 } } });
    const r = await services.refresh.refresh();
    expect(r).toMatchObject({ fetched: 1, valuationRows: 1 });
    expect(
      (await prisma.accountBalance.findFirstOrThrow({ where: { accountId: valued.id } })).balance
    ).toBe(30);
  });

  it('serializes concurrent refreshes', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 1,
      price: 1,
    });
    const { services, calls } = testServices(prisma, { closes: { AAA: { '2026-10-09': 1 } } });
    await Promise.all([services.refresh.refresh(), services.refresh.refresh()]);
    expect(calls).toHaveLength(1);
  });
});
