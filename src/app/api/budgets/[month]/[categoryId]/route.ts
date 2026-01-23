import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  limitAmount: z.number(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ month: string; categoryId: string }> }
) {
  const { month, categoryId } = await params;
  const body = await req.json();
  const parsed = schema.parse(body);

  const budget = await prisma.categoryBudget.upsert({
    where: {
      month_categoryId: {
        month,
        categoryId,
      },
    },
    update: { limitAmount: parsed.limitAmount },
    create: { month, categoryId, limitAmount: parsed.limitAmount },
  });

  return NextResponse.json(budget);
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ month: string; categoryId: string }> }
) {
  const { month, categoryId } = await params;

  await prisma.categoryBudget.deleteMany({
    where: {
      month,
      categoryId,
    },
  });

  return NextResponse.json({ success: true });
}
