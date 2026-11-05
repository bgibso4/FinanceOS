import type { PrismaClient } from '@prisma/client';

export type TravelGroup = { id: string; categoryIds: string[]; flightsAndLodgingIds: string[] };

/** A group's children when it has any, else the category itself. */
export async function categoryIdsInGroup(
  prisma: PrismaClient,
  categoryId: string
): Promise<string[]> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  return children.length > 0 ? children.map((c) => c.id) : [categoryId];
}

/** The top-level expense category named Travel, with its children's ids. */
export async function findTravelGroup(prisma: PrismaClient): Promise<TravelGroup | null> {
  const group = await prisma.category.findFirst({
    where: { name: 'Travel', type: 'expense', parentId: null },
    select: { id: true },
  });
  if (!group) return null;
  const children = await prisma.category.findMany({
    where: { parentId: group.id },
    select: { id: true, name: true },
  });
  const flightsAndLodgingIds = children
    .filter((c) => /flights|lodging/i.test(c.name))
    .map((c) => c.id);
  return { id: group.id, categoryIds: children.map((c) => c.id), flightsAndLodgingIds };
}

/** Every category that counts as Travel: the group and its children. No group, none. */
export function travelCategoryIds(group: TravelGroup | null): string[] {
  return group ? [group.id, ...group.categoryIds] : [];
}

export function isIncomeCategory(c: { type: string } | null | undefined): boolean {
  return c?.type === 'income';
}
