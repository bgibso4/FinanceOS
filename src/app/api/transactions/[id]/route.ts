import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const updateSchema = z.object({
  date: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      // Parse date as UTC to avoid timezone issues
      const dateStr = val.split('T')[0]; // Get YYYY-MM-DD
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    }),
  amount: z.number().optional(),
  merchant: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  isTransfer: z.boolean().optional(),
  transferGroupId: z.string().nullable().optional(),
  confidenceScore: z.number().optional(),
  isOffset: z.boolean().optional(),
  linkedTransactionId: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.parse(body);

  // If editing a split part's amount, enforce sum constraint
  if (parsed.amount !== undefined) {
    const current = await prisma.transaction.findUniqueOrThrow({
      where: { id },
    });

    if (current.parentTransactionId) {
      const parent = await prisma.transaction.findUniqueOrThrow({
        where: { id: current.parentTransactionId },
      });

      const siblings = await prisma.transaction.findMany({
        where: {
          parentTransactionId: current.parentTransactionId,
          id: { not: id },
        },
      });

      const siblingSum = siblings.reduce((sum, s) => sum + s.amount, 0);
      const newTotal = siblingSum + parsed.amount;

      if (Math.abs(newTotal - parent.amount) > 0.001) {
        return NextResponse.json(
          {
            error: `Split parts must sum to ${parent.amount}. New sum would be: ${newTotal}`,
          },
          { status: 400 }
        );
      }
    }
  }

  // If manually setting a category, boost confidence to 1.0 (manual override)
  const updateData: any = {
    ...parsed,
    tags: parsed.tags ? JSON.stringify(parsed.tags) : undefined,
  };

  // If categoryId is being set and confidence isn't explicitly provided, set to 1.0
  if (parsed.categoryId !== undefined && parsed.confidenceScore === undefined) {
    updateData.confidenceScore = 1.0;
  }

  const tx = await prisma.transaction.update({
    where: { id },
    data: updateData,
  });
  return NextResponse.json(tx);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id } });

    if (tx.parentTransactionId) {
      return NextResponse.json(
        { error: 'Cannot delete a split part. Use unsplit to restore the original transaction.' },
        { status: 400 }
      );
    }

    await prisma.transaction.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
