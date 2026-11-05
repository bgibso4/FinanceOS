import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createGoalData,
  createTransactionData,
} from '../../helpers/factories';
import { applyTripConversionPlan, buildTripConversionPlan } from '@/lib/travel/tag-conversion';

describe('trip tag conversion', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(teardownTestDb);
  beforeEach(resetTestDb);

  async function seed() {
    const account = await prisma.account.create({ data: createAccountData() });
    const travel = await prisma.category.create({ data: createCategoryData({ name: 'Travel' }) });
    const food = await prisma.category.create({
      data: createCategoryData({ name: 'Dining', parentId: travel.id }),
    });
    const flights = await prisma.category.create({
      data: createCategoryData({ name: 'Flights', parentId: travel.id }),
    });
    return { account, travel, food, flights };
  }

  const tx = (
    accountId: string,
    date: string,
    tags: string[],
    extra: Record<string, unknown> = {}
  ) =>
    createTransactionData(accountId, {
      date: new Date(`${date}T12:00:00Z`),
      tags: JSON.stringify(tags),
      ...extra,
    });

  it('matchesOnlyYearPrefixedTags', async () => {
    const { account } = await seed();
    for (const name of ['2026 - Miami', 'Green Card', '2026-Nope', 'x 2026 - Y'])
      await prisma.tag.create({ data: { name } });
    await prisma.transaction.create({ data: tx(account.id, '2026-03-02', ['2026 - Miami']) });
    const plan = await buildTripConversionPlan(prisma);
    expect(plan.trips.map((t) => t.name)).toEqual(['Miami']);
    expect(plan.trips[0]).toMatchObject({ tagName: '2026 - Miami' });
  });

  it('datesSkipFlightsAndLodging', async () => {
    const { account, food, flights } = await seed();
    await prisma.tag.create({ data: { name: '2026 - Miami' } });
    const t = ['2026 - Miami'];
    await prisma.transaction.create({
      data: tx(account.id, '2026-01-05', t, { categoryId: flights.id }),
    });
    await prisma.transaction.create({
      data: tx(account.id, '2026-03-02', t, { categoryId: food.id }),
    });
    await prisma.transaction.create({
      data: tx(account.id, '2026-03-09', t, { categoryId: food.id }),
    });
    await prisma.transaction.create({ data: tx(account.id, '2026-04-20', t) });
    const [trip] = (await buildTripConversionPlan(prisma)).trips;
    expect(trip).toMatchObject({ startDate: '2026-03-02', endDate: '2026-03-09' });
    expect(trip.transactionIds).toHaveLength(4);
  });

  it('datesFallBackToAllRows', async () => {
    const { account, flights } = await seed();
    await prisma.tag.create({ data: { name: '2026 - Miami' } });
    const t = ['2026 - Miami'];
    await prisma.transaction.create({
      data: tx(account.id, '2026-01-05', t, { categoryId: flights.id }),
    });
    await prisma.transaction.create({ data: tx(account.id, '2026-03-09', t) });
    const [trip] = (await buildTripConversionPlan(prisma)).trips;
    expect(trip).toMatchObject({ startDate: '2026-01-05', endDate: '2026-03-09' });
  });

  it('splitParentsIgnoredForPlanAndTripId', async () => {
    const { account, food } = await seed();
    await prisma.tag.create({ data: { name: '2026 - Miami' } });
    const t = ['2026 - Miami'];
    const parent = await prisma.transaction.create({
      data: tx(account.id, '2026-01-01', t, { isSplitParent: true }),
    });
    await prisma.transaction.create({
      data: tx(account.id, '2026-03-02', t, { categoryId: food.id }),
    });
    const plan = await buildTripConversionPlan(prisma);
    expect(plan.trips[0]).toMatchObject({ startDate: '2026-03-02', endDate: '2026-03-02' });
    expect(plan.trips[0].transactionIds).not.toContain(parent.id);
    await applyTripConversionPlan(prisma, plan);
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: parent.id } });
    expect(after.tripId).toBeNull();
    expect(JSON.parse(after.tags!)).toEqual([]);
  });

  it('applyMovesRowsDeletesTagsKeepsOtherTags', async () => {
    const { account } = await seed();
    await prisma.tag.createMany({
      data: [{ name: '2026 - Miami' }, { name: 'Tax Deductable' }, { name: 'Green Card' }],
    });
    const a = await prisma.transaction.create({
      data: tx(account.id, '2026-03-02', ['2026 - Miami', 'Tax Deductable']),
    });
    const other = await prisma.trip.create({
      data: { name: 'Earlier', startDate: '2026-03-01', endDate: '2026-03-03' },
    });
    const b = await prisma.transaction.create({
      data: tx(account.id, '2026-03-03', ['2026 - Miami'], { tripId: other.id }),
    });
    const keep = await prisma.transaction.create({
      data: tx(account.id, '2026-03-04', ['Green Card']),
    });
    await applyTripConversionPlan(prisma, await buildTripConversionPlan(prisma));

    const trip = await prisma.trip.findFirstOrThrow({ where: { name: 'Miami' } });
    expect(trip).toMatchObject({ startDate: '2026-03-02', endDate: '2026-03-03' });
    const ra = await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } });
    expect(ra.tripId).toBe(trip.id);
    expect(JSON.parse(ra.tags!)).toEqual(['Tax Deductable']);
    const rb = await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } });
    expect(rb.tripId).toBe(other.id);
    expect(JSON.parse(rb.tags!)).toEqual([]);
    const rk = await prisma.transaction.findUniqueOrThrow({ where: { id: keep.id } });
    expect(JSON.parse(rk.tags!)).toEqual(['Green Card']);
    expect((await prisma.tag.findMany()).map((t) => t.name).sort()).toEqual([
      'Green Card',
      'Tax Deductable',
    ]);
  });

  it('applySwitchesTravelGoal', async () => {
    const { account, travel, food } = await seed();
    const goal = await prisma.goal.create({
      data: createGoalData({
        name: '2026 Travel Budget',
        categoryId: travel.id,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    });
    const noDate = await prisma.goal.create({
      data: createGoalData({ name: 'Undated', categoryId: travel.id }),
    });
    const dining = await prisma.goal.create({
      data: createGoalData({ name: 'Dining', categoryId: food.id }),
    });
    await prisma.tag.create({ data: { name: '2026 - Miami' } });
    await prisma.transaction.create({ data: tx(account.id, '2026-03-02', ['2026 - Miami']) });
    const plan = await buildTripConversionPlan(prisma);
    expect(plan.travelGoalIds).toEqual([goal.id]);
    expect(plan.warnings.join('\n')).toContain('Undated');
    await applyTripConversionPlan(prisma, plan);
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).toMatchObject({
      trackingMethod: 'travel',
      categoryId: null,
    });
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: noDate.id } })).trackingMethod).toBe(
      'category'
    );
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: dining.id } })).categoryId).toBe(
      food.id
    );
  });

  it('tagReferencedByGoalIsSkippedAndListed', async () => {
    const { account } = await seed();
    const tag = await prisma.tag.create({ data: { name: '2026 - Miami' } });
    await prisma.tag.create({ data: { name: '2026 - Bayfield' } });
    const goal = await prisma.goal.create({
      data: createGoalData({ name: 'Miami fund', trackingMethod: 'tag', tagId: tag.id }),
    });
    const row = await prisma.transaction.create({
      data: tx(account.id, '2026-03-02', ['2026 - Miami']),
    });
    await prisma.transaction.create({ data: tx(account.id, '2026-05-02', ['2026 - Bayfield']) });
    const plan = await buildTripConversionPlan(prisma);
    expect(plan.trips.map((t) => t.name)).toEqual(['Bayfield']);
    expect(plan.skipped).toEqual([
      { tagName: '2026 - Miami', reason: expect.stringContaining('Miami fund') },
    ]);
    await applyTripConversionPlan(prisma, plan);
    expect(await prisma.tag.findUnique({ where: { id: tag.id } })).not.toBeNull();
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })).tagId).toBe(tag.id);
    expect(
      JSON.parse((await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).tags!)
    ).toEqual(['2026 - Miami']);
  });

  it('tagWithNoUsableRowsIsSkipped', async () => {
    await seed();
    await prisma.tag.create({ data: { name: '2026 - Empty' } });
    const plan = await buildTripConversionPlan(prisma);
    expect(plan.trips).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it('secondRunIsNoOp', async () => {
    const { account } = await seed();
    await prisma.tag.create({ data: { name: '2026 - Miami' } });
    await prisma.transaction.create({ data: tx(account.id, '2026-03-02', ['2026 - Miami']) });
    await applyTripConversionPlan(prisma, await buildTripConversionPlan(prisma));
    const plan = await buildTripConversionPlan(prisma);
    expect(plan).toEqual({ trips: [], travelGoalIds: [], skipped: [], warnings: [] });
    await applyTripConversionPlan(prisma, plan);
    expect(await prisma.trip.count()).toBe(1);
  });
});
