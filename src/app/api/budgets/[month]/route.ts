import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;

  // Get default budgets and month-specific budgets
  const [defaultBudgets, monthBudgets] = await Promise.all([
    prisma.categoryBudget.findMany({
      where: { month: 'default' },
      include: { category: true },
    }),
    month !== 'default'
      ? prisma.categoryBudget.findMany({
          where: { month },
          include: { category: true },
        })
      : Promise.resolve([]),
  ]);

  // Merge: month-specific overrides take precedence over defaults
  const budgetMap = new Map<string, (typeof defaultBudgets)[0]>();

  // Add defaults first
  defaultBudgets.forEach((b) => {
    budgetMap.set(b.categoryId, b);
  });

  // Override with month-specific
  monthBudgets.forEach((b) => {
    budgetMap.set(b.categoryId, b);
  });

  const mergedBudgets = Array.from(budgetMap.values());

  return NextResponse.json({
    budgets: mergedBudgets.map((b) => ({
      ...b,
      limitAmount: Number(b.limitAmount),
      isOverride: b.month !== 'default',
    })),
  });
}
