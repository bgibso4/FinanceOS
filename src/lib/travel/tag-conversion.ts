import type { Prisma, PrismaClient } from '@prisma/client';
import { findTravelGroup, travelCategoryIds } from '@/lib/categories';
import { isoDay } from '@/lib/investments/dates';
import { parseTags, parseTagsStrict } from '@/lib/transaction-rows';
import { budgetName } from '@/lib/travel/budget';

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
  /** Names of the goals in `travelGoalIds`, same order (for the dry run). */
  travelGoalNames: string[];
  /** Trip tags left untouched, with why (a goal tracks the tag, or no unassigned transactions). */
  skipped: { tagName: string; reason: string }[];
  warnings: string[];
}

/** Every row carrying the tag, split parents included (the tag row is deleted, so all must be stripped). */
async function rowsWithTag(
  db: PrismaClient | Prisma.TransactionClient,
  tagName: string,
  warnings?: string[]
) {
  const candidates = await db.transaction.findMany({
    where: { tags: { contains: JSON.stringify(tagName) } },
    select: {
      id: true,
      date: true,
      amount: true,
      categoryId: true,
      isSplitParent: true,
      tripId: true,
      tags: true,
    },
  });
  return candidates.filter((r) => {
    const tags = parseTagsStrict(r.tags);
    if (tags === null) {
      warnings?.push(`Transaction ${r.id} has unreadable tags and was not converted`);
      return false;
    }
    return tags.includes(tagName);
  });
}

export async function buildTripConversionPlan(prisma: PrismaClient): Promise<TripConversionPlan> {
  const plan: TripConversionPlan = {
    trips: [],
    travelGoalIds: [],
    travelGoalNames: [],
    skipped: [],
    warnings: [],
  };
  const group = await findTravelGroup(prisma);
  const travelIds = new Set(travelCategoryIds(group));
  const excluded = new Set(group?.flightsAndLodgingIds ?? []);
  const tripTags = (await prisma.tag.findMany())
    .filter((t) => TRIP_TAG.test(t.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Candidate rows per tag: not a split parent, not already on a trip.
  const candidates = new Map<string, Awaited<ReturnType<typeof rowsWithTag>>>();
  const claimedBy = new Map<string, string[]>();
  const convertible = [];
  for (const tag of tripTags) {
    const goals = await prisma.goal.findMany({ where: { tagId: tag.id }, select: { name: true } });
    if (goals.length) {
      const names = goals.map((g) => `"${g.name}"`).join(', ');
      plan.skipped.push({ tagName: tag.name, reason: `tracked by goal ${names}` });
      continue;
    }
    const rows = (await rowsWithTag(prisma, tag.name, plan.warnings)).filter(
      (r) => !r.isSplitParent && !r.tripId
    );
    candidates.set(tag.name, rows);
    for (const r of rows) claimedBy.set(r.id, [...(claimedBy.get(r.id) ?? []), tag.name]);
    convertible.push(tag);
  }
  for (const [id, names] of claimedBy)
    if (names.length > 1)
      plan.warnings.push(
        `Transaction ${id} carries trip tags ${names.map((n) => `"${n}"`).join(' and ')}; it goes to "${names[0]}" only`
      );

  for (const tag of convertible) {
    const rows = candidates.get(tag.name)!.filter((r) => claimedBy.get(r.id)![0] === tag.name);
    if (!rows.length) {
      plan.skipped.push({
        tagName: tag.name,
        reason: 'no unassigned transactions to date the trip from',
      });
      continue;
    }
    const spending = rows.some((r) => r.amount < 0) ? rows.filter((r) => r.amount < 0) : rows;
    const travelSpend = spending.filter(
      (r) => r.categoryId && travelIds.has(r.categoryId) && !excluded.has(r.categoryId)
    );
    const dated = (travelSpend.length ? travelSpend : spending).map((r) => isoDay(r.date)).sort();
    plan.trips.push({
      tagId: tag.id,
      tagName: tag.name,
      name: tag.name.replace(TRIP_TAG, ''),
      startDate: dated[0],
      endDate: dated[dated.length - 1],
      transactionIds: rows.map((r) => r.id),
    });
  }

  if (group) await planGoals(prisma, group.id, plan);
  return plan;
}

/** Switch only goals named exactly like a Travel budget; warn about every other Travel category goal. */
async function planGoals(prisma: PrismaClient, groupId: string, plan: TripConversionPlan) {
  const goals = await prisma.goal.findMany({
    where: { trackingMethod: 'category', categoryId: groupId },
    select: { id: true, name: true, startDate: true },
  });
  const existing = new Set(
    (
      await prisma.goal.findMany({ where: { trackingMethod: 'travel' }, select: { name: true } })
    ).map((g) => g.name)
  );
  for (const g of goals) {
    const expected = g.startDate ? budgetName(Number(g.startDate.slice(0, 4))) : null;
    if (g.name !== expected) {
      plan.warnings.push(
        `Goal "${g.name}" tracks the Travel category but is not named like a travel budget; left unchanged`
      );
    } else if (existing.has(g.name)) {
      plan.warnings.push(
        `Goal "${g.name}" would duplicate an existing travel budget; left unchanged`
      );
    } else {
      existing.add(g.name);
      plan.travelGoalIds.push(g.id);
      plan.travelGoalNames.push(g.name);
    }
  }
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
        for (const row of await rowsWithTag(tx, t.tagName)) {
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
