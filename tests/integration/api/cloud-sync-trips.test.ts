import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createTransactionData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import {
  exportDatabase,
  importDatabase,
  generateChecksum,
  setPrismaClient,
  resetPrismaClient,
} from '@/lib/cloud-sync/sync';

describe('cloud-sync trips', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.SYNC_ENCRYPTION_KEY = 'YV10ZXN0LWtleS10aGF0LWlzLWV4YWN0bHktMzItYiE=';
    prisma = await setupTestDb();
    setPrismaClient(prisma);
  });

  afterAll(async () => {
    resetPrismaClient();
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  async function seedTrip() {
    const account = await prisma.account.create({ data: createAccountData() });
    const trip = await prisma.trip.create({
      data: { name: 'Whistler', startDate: '2026-01-13', endDate: '2026-01-21' },
    });
    const inTrip = await prisma.transaction.create({
      data: { ...createTransactionData(account.id), tripId: trip.id },
    });
    const other = await prisma.transaction.create({ data: createTransactionData(account.id) });
    await prisma.tripDismissal.create({ data: { tripId: trip.id, transactionId: other.id } });
    return { trip, inTrip, other };
  }

  it('tripsSurviveSyncRoundTrip', async () => {
    const { trip, inTrip, other } = await seedTrip();

    const payload = await exportDatabase();
    expect(payload.metadata.recordCounts.trips).toBe(1);
    expect(payload.metadata.recordCounts.tripDismissals).toBe(1);
    await importDatabase(payload);

    const trips = await prisma.trip.findMany();
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      id: trip.id,
      name: 'Whistler',
      startDate: '2026-01-13',
      endDate: '2026-01-21',
    });
    expect((await prisma.transaction.findUnique({ where: { id: inTrip.id } }))?.tripId).toBe(
      trip.id
    );
    expect((await prisma.transaction.findUnique({ where: { id: other.id } }))?.tripId).toBeNull();
    const dismissals = await prisma.tripDismissal.findMany();
    expect(dismissals).toHaveLength(1);
    expect(dismissals[0]).toMatchObject({ tripId: trip.id, transactionId: other.id });
  });

  it('oldPayloadWithoutTripsImports', async () => {
    await seedTrip();
    const payload = await exportDatabase();
    const data = { ...payload.data } as Record<string, unknown>;
    delete data.trips;
    delete data.tripDismissals;
    // old payloads have no tripId on transactions either
    data.transactions = payload.data.transactions.map(({ tripId: _t, ...rest }) => rest);
    const oldData = data as typeof payload.data;
    const old = {
      ...payload,
      data: oldData,
      metadata: { ...payload.metadata, checksum: await generateChecksum(oldData) },
    };

    await importDatabase(old);

    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.tripDismissal.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(2);
  });
});
