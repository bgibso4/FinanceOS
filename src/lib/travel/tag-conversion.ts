import type { PrismaClient } from '@prisma/client';
import { findTravelGroup } from '@/lib/categories';

const TRIP_TAG = /^\d{4} - /;

export interface PlannedTrip {
  tagId: string;
  tagName: string;
  name: string;
  startDate: string;
  endDate: string;
  transactionIds: string[];
}

export interface TripConversionPlan {
  trips: PlannedTrip[];
  travelGoalIds: string[];
  /** Trip tags left untouched, with why (a goal tracks the tag, or no usable transactions). */
  skipped: { tagName: string; reason: string }[];
  warnings: string[];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Every row carrying the tag, split parents included (the tag row is deleted, so all must be stripped). */
async function rowsWithTag(prisma: PrismaClient, tagName: string) {
  const candidates = await prisma.transaction.findMany({
    where: { tags: { contains: `"${tagName}"` } },
    select: { id: true, date: true, categoryId: true, isSplitParent: true, tags: true },
  });
  return candidates.filter((r) => parseTags(r.tags).includes(tagName));
}

export async function buildTripConversionPlan(prisma: PrismaClient): Promise<TripConversionPlan> {
  const plan: TripConversionPlan = { trips: [], travelGoalIds: [], skipped: [], warnings: [] };
  const group = await findTravelGroup(prisma);
  const allTags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  for (const tag of allTags.filter((t) => TRIP_TAG.test(t.name))) {
    const goals = await prisma.goal.findMany({ where: { tagId: tag.id }, select: { name: true } });
    if (goals.length) {
      const names = goals.map((g) => `"${g.name}"`).join(', ');
      plan.skipped.push({ tagName: tag.name, reason: `tracked by goal ${names}` });
      continue;
    }
    const rows = (await rowsWithTag(prisma, tag.name)).filter((r) => !r.isSplitParent);
    if (!rows.length) {
      plan.skipped.push({ tagName: tag.name, reason: 'no transactions to date the trip from' });
      continue;
    }
    const travelIds = new Set([group?.id, ...(group?.categoryIds ?? [])]);
    const excluded = new Set(group?.flightsAndLodgingIds ?? []);
    const spend = rows.filter(
      (r) => r.categoryId && travelIds.has(r.categoryId) && !excluded.has(r.categoryId)
    );
    const dated = (spend.length ? spend : rows).map((r) => isoDay(r.date)).sort();
    plan.trips.push({
      tagId: tag.id,
      tagName: tag.name,
      name: tag.name.replace(TRIP_TAG, ''),
      startDate: dated[0],
      endDate: dated[dated.length - 1],
      transactionIds: rows.map((r) => r.id),
    });
  }

  if (group) {
    const goals = await prisma.goal.findMany({
      where: { trackingMethod: 'category', categoryId: group.id },
      select: { id: true, name: true, startDate: true },
    });
    for (const g of goals) {
      if (g.startDate) plan.travelGoalIds.push(g.id);
      else plan.warnings.push(`Goal "${g.name}" has no start date; left as a category goal`);
    }
  }
  return plan;
}

export async function applyTripConversionPlan(
  prisma: PrismaClient,
  plan: TripConversionPlan
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const t of plan.trips) {
        const trip = await tx.trip.create({
          data: { name: t.name, startDate: t.startDate, endDate: t.endDate },
        });
        await tx.transaction.updateMany({
          where: { id: { in: t.transactionIds }, tripId: null },
          data: { tripId: trip.id },
        });
        for (const row of await rowsWithTag(tx as PrismaClient, t.tagName)) {
          const kept = parseTags(row.tags).filter((name) => name !== t.tagName);
          await tx.transaction.update({
            where: { id: row.id },
            data: { tags: JSON.stringify(kept) },
          });
        }
        await tx.tag.delete({ where: { id: t.tagId } });
      }
      if (plan.travelGoalIds.length) {
        await tx.goal.updateMany({
          where: { id: { in: plan.travelGoalIds } },
          data: { trackingMethod: 'travel', categoryId: null },
        });
      }
    },
    { timeout: 60_000 }
  );
}
