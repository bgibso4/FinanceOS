import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET all default budgets
export async function GET() {
  const budgets = await prisma.categoryBudget.findMany({
    where: { month: 'default' },
    include: { category: true },
  });

  return NextResponse.json({
    budgets: budgets.map((b) => ({
      ...b,
      limitAmount: Number(b.limitAmount),
    })),
  });
}

// POST to create/update a default budget
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { categoryId, limitAmount } = body;

  if (!categoryId || typeof limitAmount !== 'number') {
    return NextResponse.json({ error: 'categoryId and limitAmount required' }, { status: 400 });
  }

  const budget = await prisma.categoryBudget.upsert({
    where: {
      month_categoryId: {
        month: 'default',
        categoryId,
      },
    },
    update: { limitAmount },
    create: { month: 'default', categoryId, limitAmount },
    include: { category: true },
  });

  return NextResponse.json({
    ...budget,
    limitAmount: Number(budget.limitAmount),
  });
}

// DELETE a default budget
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get('categoryId');

  if (!categoryId) {
    return NextResponse.json({ error: 'categoryId required' }, { status: 400 });
  }

  await prisma.categoryBudget.deleteMany({
    where: {
      month: 'default',
      categoryId,
    },
  });

  return NextResponse.json({ success: true });
}
