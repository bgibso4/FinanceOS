import type { PrismaClient, Goal } from '@prisma/client';
import { getAccountBalance } from '@/lib/balances';
import { categoryIdsInGroup } from '@/lib/categories';
import { TravelTotals } from '@/lib/travel/totals';

/** Travel budgets are created by the Travel feature, never through the Goals API. */
export const TRAVEL_GOAL_ERROR = 'Travel budgets are managed in Travel';

export type GoalProgress = {
  currentAmount: number;
  percentage: number;
  remaining: number;
  paceStatus: 'on_track' | 'ahead' | 'behind' | null;
};

export async function calculateGoalProgress(
  goal: Goal,
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<GoalProgress> {
  const tracker = GOAL_TRACKERS[goal.trackingMethod];
  const currentAmount = tracker ? await tracker(goal, prisma) : 0;

  const percentage = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
  const remaining = Math.max(0, goal.targetAmount - currentAmount);
  const paceStatus = calculatePaceStatus(goal, percentage, now);

  return { currentAmount, percentage, remaining, paceStatus };
}

async function calculateCategoryProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  const categoryIds = await categoryIdsInGroup(prisma, goal.categoryId!);

  const dateFilter = buildDateFilter(goal);

  const result = await prisma.transaction.aggregate({
    where: {
      categoryId: { in: categoryIds },
      isSplitParent: false,
      ...dateFilter,
    },
    _sum: { amount: true },
  });

  return Math.abs(result._sum.amount ?? 0);
}

async function calculateTagProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  const tag = await prisma.tag.findUnique({ where: { id: goal.tagId! } });
  if (!tag) return 0;

  const dateFilter = buildDateFilter(goal);

  // Tags are stored as JSON string arrays, use contains for SQLite
  const transactions = await prisma.transaction.findMany({
    where: {
      tags: { contains: `"${tag.name}"` },
      isSplitParent: false,
      ...dateFilter,
    },
    select: { amount: true },
  });

  return transactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
}

async function calculateAccountProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  const { balance } = await getAccountBalance(prisma, goal.accountId!);
  return Math.abs(balance);
}

export type GoalTracker = (goal: Goal, prisma: PrismaClient) => Promise<number>;

// A tracker whose target id is unset counts zero, as before.
export const GOAL_TRACKERS: Record<string, GoalTracker> = {
  category: (goal, prisma) =>
    goal.categoryId ? calculateCategoryProgress(goal, prisma) : Promise.resolve(0),
  tag: (goal, prisma) => (goal.tagId ? calculateTagProgress(goal, prisma) : Promise.resolve(0)),
  account: (goal, prisma) =>
    goal.accountId ? calculateAccountProgress(goal, prisma) : Promise.resolve(0),
  // Imports totals.ts directly: services.ts and budget.ts import this file.
  travel: (goal, prisma) =>
    goal.startDate
      ? new TravelTotals(prisma).budgetSpent(Number(goal.startDate.slice(0, 4)))
      : Promise.resolve(0),
};

function buildDateFilter(goal: Goal): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (goal.startDate || goal.endDate) {
    const dateCondition: Record<string, Date> = {};
    if (goal.startDate) dateCondition.gte = new Date(goal.startDate);
    if (goal.endDate) dateCondition.lte = new Date(goal.endDate + 'T23:59:59.999Z');
    filter.date = dateCondition;
  }

  return filter;
}

function calculatePaceStatus(
  goal: Goal,
  percentage: number,
  now: Date
): 'on_track' | 'ahead' | 'behind' | null {
  if (!goal.startDate || !goal.endDate) return null;

  const start = new Date(goal.startDate);
  const end = new Date(goal.endDate + 'T23:59:59.999Z');
  const totalDuration = end.getTime() - start.getTime();

  if (totalDuration <= 0) return null;

  const elapsed = Math.max(0, Math.min(now.getTime() - start.getTime(), totalDuration));
  const timePercentage = (elapsed / totalDuration) * 100;

  const tolerance = 5; // 5% tolerance band

  if (goal.type === 'spending') {
    // For spending: being under pace is good (ahead), over pace is bad (behind)
    if (percentage < timePercentage - tolerance) return 'ahead';
    if (percentage > timePercentage + tolerance) return 'behind';
    return 'on_track';
  } else {
    // For saving: being over pace is good (ahead), under pace is bad (behind)
    if (percentage > timePercentage + tolerance) return 'ahead';
    if (percentage < timePercentage - tolerance) return 'behind';
    return 'on_track';
  }
}
