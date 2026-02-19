import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { calculateGoalProgress } from '@/lib/goals';

const updateGoalSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['spending', 'saving']).optional(),
  targetAmount: z.number().positive().optional(),
  trackingMethod: z.enum(['category', 'tag', 'account']).optional(),
  categoryId: z.string().nullable().optional(),
  tagId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateGoalSchema.parse(body);

  const goal = await prisma.goal.update({
    where: { id },
    data: parsed,
    include: { category: true, tag: true, account: true },
  });

  const progress = await calculateGoalProgress(goal, prisma);
  return NextResponse.json({ ...goal, ...progress });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await prisma.goal.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
