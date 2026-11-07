import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createCategoryData } from '../../helpers/factories';
import { categoryIdsInGroup, findTravelGroup, isIncomeCategory } from '@/lib/categories';
import type { PrismaClient } from '@prisma/client';

describe('categories', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  async function seedTravel() {
    const travel = await prisma.category.create({
      data: createCategoryData({ name: 'Travel', type: 'expense' }),
    });
    const children = [];
    for (const name of ['✈️ Flights', '🏘️ Lodging', '🍴Drinks and Food']) {
      children.push(
        await prisma.category.create({
          data: createCategoryData({ name, type: 'expense', parentId: travel.id }),
        })
      );
    }
    return { travel, children };
  }

  it('groupResolvesToChildren', async () => {
    const { travel, children } = await seedTravel();
    const ids = await categoryIdsInGroup(prisma, travel.id);
    expect(ids.sort()).toEqual(children.map((c) => c.id).sort());
  });

  it('leafResolvesToItself', async () => {
    const { children } = await seedTravel();
    expect(await categoryIdsInGroup(prisma, children[0].id)).toEqual([children[0].id]);
  });

  it('findsTravelGroupWithFlightsAndLodging', async () => {
    const { travel, children } = await seedTravel();
    const group = await findTravelGroup(prisma);
    expect(group?.id).toBe(travel.id);
    expect(group?.categoryIds).toHaveLength(3);
    expect(group?.flightsAndLodgingIds.sort()).toEqual([children[0].id, children[1].id].sort());
  });

  it('noTravelGroupReturnsNull', async () => {
    await prisma.category.create({ data: createCategoryData({ name: 'Groceries' }) });
    expect(await findTravelGroup(prisma)).toBeNull();
  });

  it('incomeChildIsIncome', async () => {
    expect(isIncomeCategory({ type: 'income' })).toBe(true);
    expect(isIncomeCategory({ type: 'expense' })).toBe(false);
    expect(isIncomeCategory(null)).toBe(false);
  });
});
