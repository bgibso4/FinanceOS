import type { PrismaClient, Goal } from '@prisma/client';

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
  let currentAmount = 0;

  if (goal.trackingMethod === 'category' && goal.categoryId) {
    currentAmount = await calculateCategoryProgress(goal, prisma);
  } else if (goal.trackingMethod === 'tag' && goal.tagId) {
    currentAmount = await calculateTagProgress(goal, prisma);
  } else if (goal.trackingMethod === 'account' && goal.accountId) {
    currentAmount = await calculateAccountProgress(goal, prisma);
  }

  const percentage = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
  const remaining = Math.max(0, goal.targetAmount - currentAmount);
  const paceStatus = calculatePaceStatus(goal, percentage, now);

  return { currentAmount, percentage, remaining, paceStatus };
}

async function calculateCategoryProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  // Check if this category is a group (has children)
  const children = await prisma.category.findMany({
    where: { parentId: goal.categoryId! },
    select: { id: true },
  });

  const categoryIds = children.length > 0 ? children.map((c) => c.id) : [goal.categoryId!];

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
  // Sum all transactions in the account to get current balance
  const result = await prisma.transaction.aggregate({
    where: { accountId: goal.accountId!, isSplitParent: false },
    _sum: { amount: true },
  });

  return Math.abs(result._sum.amount ?? 0);
}

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
