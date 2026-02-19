import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { calculateGoalProgress } from '@/lib/goals';

const createGoalSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['spending', 'saving']),
  targetAmount: z.number().positive(),
  trackingMethod: z.enum(['category', 'tag', 'account']),
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  accountId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') || 'active';

  const where = status === 'all' ? {} : { status };

  const goals = await prisma.goal.findMany({
    where,
    include: { category: true, tag: true, account: true },
    orderBy: { createdAt: 'desc' },
  });

  const goalsWithProgress = await Promise.all(
    goals.map(async (goal) => {
      const progress = await calculateGoalProgress(goal, prisma);
      return { ...goal, ...progress };
    })
  );

  return NextResponse.json({ goals: goalsWithProgress });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createGoalSchema.parse(body);

  if (parsed.trackingMethod === 'category' && !parsed.categoryId) {
    return NextResponse.json(
      { error: 'categoryId is required for category tracking' },
      { status: 400 }
    );
  }
  if (parsed.trackingMethod === 'tag' && !parsed.tagId) {
    return NextResponse.json({ error: 'tagId is required for tag tracking' }, { status: 400 });
  }
  if (parsed.trackingMethod === 'account' && !parsed.accountId) {
    return NextResponse.json(
      { error: 'accountId is required for account tracking' },
      { status: 400 }
    );
  }

  const goal = await prisma.goal.create({
    data: {
      name: parsed.name,
      type: parsed.type,
      targetAmount: parsed.targetAmount,
      trackingMethod: parsed.trackingMethod,
      categoryId: parsed.trackingMethod === 'category' ? parsed.categoryId : null,
      tagId: parsed.trackingMethod === 'tag' ? parsed.tagId : null,
      accountId: parsed.trackingMethod === 'account' ? parsed.accountId : null,
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
    },
    include: { category: true, tag: true, account: true },
  });

  const progress = await calculateGoalProgress(goal, prisma);
  return NextResponse.json({ ...goal, ...progress });
}
