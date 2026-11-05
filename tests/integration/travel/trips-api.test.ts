import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { GET as listTrips, POST as createTrip } from '@/app/api/travel/trips/route';
import {
  GET as getTrip,
  PATCH as patchTrip,
  DELETE as deleteTrip,
} from '@/app/api/travel/trips/[id]/route';
import {
  GET as getSuggestions,
  POST as assign,
} from '@/app/api/travel/trips/[id]/suggestions/route';
import { PATCH as patchTx } from '@/app/api/transactions/[id]/route';
import { POST as split } from '@/app/api/transactions/split/route';
import { POST as unsplit } from '@/app/api/transactions/unsplit/route';

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/x', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const JAPAN = { name: 'Japan', startDate: '2026-01-13', endDate: '2026-01-21' };

describe('travel trips API', () => {
  let accountId: string;
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(teardownTestDb);
  beforeEach(async () => {
    await resetTestDb();
    accountId = (await testPrisma.account.create({ data: createAccountData() })).id;
  });

  const tx = (amount: number, date = '2026-01-15', o: { tripId?: string } = {}) =>
    testPrisma.transaction.create({
      data: {
        accountId,
        date: new Date(`${date}T00:00:00Z`),
        amount,
        merchant: 'Hotel',
        merchantNormalized: 'hotel',
        importHash: `h-${Math.random()}`,
        ...o,
      },
    });
  const newTrip = async () => (await (await createTrip(req('POST', JAPAN))).json()).id as string;

  it('createsAndListsTrips', async () => {
    const res = await createTrip(req('POST', { ...JAPAN, name: '  Japan  ' }));
    expect(res.status).toBe(201);
    await createTrip(
      req('POST', { name: 'Later', startDate: '2026-06-01', endDate: '2026-06-02' })
    );
    const { trips } = await (await listTrips()).json();
    expect(trips.map((t: { name: string }) => t.name)).toEqual(['Later', 'Japan']);
  });

  it('rejectsEndBeforeStart', async () => {
    const res = await createTrip(req('POST', { ...JAPAN, endDate: '2026-01-01' }));
    expect(res.status).toBe(400);
  });

  it('rejectsBlankName', async () => {
    const res = await createTrip(req('POST', { ...JAPAN, name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('updatesTrip', async () => {
    const id = await newTrip();
    const res = await patchTrip(req('PATCH', { ...JAPAN, name: 'Kyoto' }), ctx(id));
    expect((await res.json()).name).toBe('Kyoto');
  });

  it('tripDetailReturnsSummaryRowsAndCount', async () => {
    const id = await newTrip();
    await tx(-100, '2026-01-15', { tripId: id });
    await tx(-30, '2026-01-16');
    const res = await getTrip(req('GET'), ctx(id));
    const body = await res.json();
    expect(body.trip.spend).toBe(100);
    expect(body.transactions).toHaveLength(1);
    expect(body.suggestionCount).toBe(1); // the loose -30 during the trip
    expect((await getTrip(req('GET'), ctx('nope'))).status).toBe(404);
  });

  it('assignAddsAndDismisses', async () => {
    const id = await newTrip();
    const a = await tx(-10);
    const b = await tx(-20);
    const res = await assign(req('POST', { add: [a.id], dismiss: [b.id] }), ctx(id));
    expect(await res.json()).toEqual({ added: 1 });
    expect((await testPrisma.transaction.findUnique({ where: { id: a.id } }))?.tripId).toBe(id);
    expect(await testPrisma.tripDismissal.count({ where: { tripId: id } })).toBe(1);
    await assign(req('POST', { add: [], dismiss: [b.id] }), ctx(id));
    expect(await testPrisma.tripDismissal.count({ where: { tripId: id } })).toBe(1);
    const { suggestions } = await (await getSuggestions(req('GET'), ctx(id))).json();
    expect(suggestions).toEqual([]);
  });

  it('assignSkipsTransactionsAlreadyOnAnotherTrip', async () => {
    const id = await newTrip();
    const other = (await testPrisma.trip.create({ data: { ...JAPAN, name: 'Other' } })).id;
    const taken = await tx(-10, '2026-01-15', { tripId: other });
    const parent = await testPrisma.transaction.update({
      where: { id: (await tx(-5)).id },
      data: { isSplitParent: true },
    });
    const res = await assign(req('POST', { add: [taken.id, parent.id], dismiss: [] }), ctx(id));
    expect(await res.json()).toEqual({ added: 0 });
    expect((await testPrisma.transaction.findUnique({ where: { id: taken.id } }))?.tripId).toBe(
      other
    );
  });

  it('deleteTripKeepsTransactions', async () => {
    const id = await newTrip();
    const a = await tx(-10, '2026-01-15', { tripId: id });
    const b = await tx(-20);
    await assign(req('POST', { add: [], dismiss: [b.id] }), ctx(id));
    const res = await deleteTrip(req('DELETE'), ctx(id));
    expect(await res.json()).toEqual({ success: true });
    expect((await testPrisma.transaction.findUnique({ where: { id: a.id } }))?.tripId).toBeNull();
    expect(await testPrisma.tripDismissal.count()).toBe(0);
  });

  it('patchTransactionSetsAndClearsTrip', async () => {
    const id = await newTrip();
    const t = await tx(-10);
    await patchTx(req('PATCH', { tripId: id }), ctx(t.id));
    expect((await testPrisma.transaction.findUnique({ where: { id: t.id } }))?.tripId).toBe(id);
    await patchTx(req('PATCH', { tripId: null }), ctx(t.id));
    expect((await testPrisma.transaction.findUnique({ where: { id: t.id } }))?.tripId).toBeNull();
  });

  it('patchTransactionRejectsSplitParent', async () => {
    const id = await newTrip();
    const t = await tx(-10);
    await testPrisma.transaction.update({ where: { id: t.id }, data: { isSplitParent: true } });
    const res = await patchTx(req('PATCH', { tripId: id }), ctx(t.id));
    expect(res.status).toBe(400);
    expect((await testPrisma.transaction.findUnique({ where: { id: t.id } }))?.tripId).toBeNull();
  });

  it('suggestionsForMissingTripIs404', async () => {
    expect((await getSuggestions(req('GET'), ctx('nope'))).status).toBe(404);
  });

  it('splitPartsInheritTripAndUnsplitKeepsIt', async () => {
    const id = await newTrip();
    const t = await tx(-10, '2026-01-15', { tripId: id });
    await split(req('POST', { transactionId: t.id, parts: [{ amount: -4 }, { amount: -6 }] }));
    const parts = await testPrisma.transaction.findMany({ where: { parentTransactionId: t.id } });
    expect(parts.map((p) => p.tripId)).toEqual([id, id]);
    await unsplit(req('POST', { transactionId: t.id }));
    expect((await testPrisma.transaction.findUnique({ where: { id: t.id } }))?.tripId).toBe(id);
  });
});
