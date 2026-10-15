import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb } from '../../helpers/db';
import { seedSecurity } from '../../helpers/investments';
import { Pricing } from '@/lib/investments/codes';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('yahoo-finance2', () => ({ default: class {} }));

import { getInvestmentServices } from '@/lib/investments/services';

describe('getInvestmentServices', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  it('renames legacy stored codes before returning the services', async () => {
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA', pricing: 'feed' });
    const [first, second] = await Promise.all([getInvestmentServices(), getInvestmentServices()]);
    expect(first).toBe(second);
    expect((await testPrisma.security.findUniqueOrThrow({ where: { id: s.id } })).pricing).toBe(
      Pricing.Market
    );
  });
});
