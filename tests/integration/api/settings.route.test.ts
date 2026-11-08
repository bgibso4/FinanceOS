import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';

let routePrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return routePrisma;
  },
}));

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/settings/route');
  return PATCH(
    new NextRequest('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  );
};

describe('PATCH /api/settings', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    routePrisma = prisma;
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('settingsPatchSavesBoth', async () => {
    const res = await patch({ baseCurrency: 'GBP', inflationRegion: 'CA' });
    expect(res.status).toBe(200);
    const stored = await prisma.userSettings.findFirst();
    expect(stored).toMatchObject({ baseCurrency: 'GBP', inflationRegion: 'CA' });
  });

  it('saves one field and leaves the other', async () => {
    await patch({ baseCurrency: 'EUR', inflationRegion: 'CA' });
    await patch({ inflationRegion: 'US' });
    expect(await prisma.userSettings.findFirst()).toMatchObject({
      baseCurrency: 'EUR',
      inflationRegion: 'US',
    });
  });

  it('settingsPatchRejectsUnknownRegion', async () => {
    await patch({ baseCurrency: 'USD' });
    const res = await patch({ inflationRegion: 'XX' });
    expect(res.status).toBe(400);
    expect((await prisma.userSettings.findFirst())?.inflationRegion).toBe('US');
  });

  it('settingsPatchRejectsUnknownCurrency', async () => {
    const res = await patch({ baseCurrency: 'XYZ' });
    expect(res.status).toBe(400);
    expect(await prisma.userSettings.findFirst()).toBeNull();
  });
});
