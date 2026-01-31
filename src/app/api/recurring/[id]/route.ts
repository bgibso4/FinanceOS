import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const updateSchema = z.object({
  merchantDisplay: z.string().min(1).optional(),
  categoryId: z.string().nullable().optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']).optional(),
  expectedAmount: z.number().optional(),
  expectedDayOfMonth: z.number().min(1).max(31).nullable().optional(),
  status: z.enum(['active', 'paused', 'cancelled', 'lapsed', 'dismissed']).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.parse(body);

  const existing = await prisma.recurringTransaction.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Recurring transaction not found' }, { status: 404 });
  }

  const recurring = await prisma.recurringTransaction.update({
    where: { id },
    data: {
      ...parsed,
      isManualOverride: true,
    },
    include: {
      account: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(recurring);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.recurringTransaction.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Recurring transaction not found' }, { status: 404 });
  }

  // Soft-delete: mark as dismissed so detection doesn't recreate it
  await prisma.recurringTransaction.update({
    where: { id },
    data: {
      status: 'dismissed',
      isManualOverride: true,
    },
  });
  return NextResponse.json({ success: true });
}
