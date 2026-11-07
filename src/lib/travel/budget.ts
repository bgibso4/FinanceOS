import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { calculateGoalProgress } from '@/lib/goals';

export const budgetName = (year: number) => `${year} Travel Budget`;

/** A year's Travel budget, stored as a spending goal so Goals shows the same figures. */
export class TravelBudget {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock = systemClock
  ) {}

  async get(year: number): Promise<{ goalId: string; target: number; spent: number } | null> {
    const goal = await this.find(year);
    if (!goal) return null;
    const { currentAmount } = await calculateGoalProgress(goal, this.prisma, this.clock.now());
    return { goalId: goal.id, target: goal.targetAmount, spent: currentAmount };
  }

  async set(year: number, amount: number): Promise<void> {
    const existing = await this.find(year);
    if (existing) {
      await this.prisma.goal.update({ where: { id: existing.id }, data: { targetAmount: amount } });
      return;
    }
    await this.prisma.goal.create({
      data: {
        name: budgetName(year),
        type: 'spending',
        trackingMethod: 'travel',
        targetAmount: amount,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      },
    });
  }

  async status(): Promise<{ year: number; hasBudget: boolean }> {
    const year = this.clock.now().getUTCFullYear();
    return { year, hasBudget: (await this.find(year)) !== null };
  }

  private find(year: number) {
    return this.prisma.goal.findFirst({
      where: { name: budgetName(year), trackingMethod: 'travel' },
    });
  }
}
