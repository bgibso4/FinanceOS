import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const bulkSchema = z.object({
  action: z.enum(['update', 'delete']),
  transactionIds: z.array(z.string()).min(1),
  data: z
    .object({
      categoryId: z.string().nullable().optional(),
      isTransfer: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
      confidenceScore: z.number().optional(),
      note: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, transactionIds, data } = bulkSchema.parse(body);

    if (action === 'delete') {
      const result = await prisma.transaction.deleteMany({
        where: { id: { in: transactionIds } },
      });
      return NextResponse.json({ success: true, affected: result.count });
    }

    // action === 'update'
    if (!data) {
      return NextResponse.json({ error: 'data required for update' }, { status: 400 });
    }

    // Tags require per-row handling (JSON field — can't use updateMany)
    if (data.tags !== undefined) {
      await prisma.$transaction(
        transactionIds.map((id) =>
          prisma.transaction.update({
            where: { id },
            data: { tags: JSON.stringify(data.tags) },
          })
        )
      );
      return NextResponse.json({ success: true, affected: transactionIds.length });
    }

    // Simple field updates can use updateMany
    const updateData: Record<string, unknown> = {};
    if (data.categoryId !== undefined) {
      updateData.categoryId = data.categoryId;
      updateData.confidenceScore = data.categoryId === null ? 0.3 : 1.0;
    }
    if (data.isTransfer !== undefined) updateData.isTransfer = data.isTransfer;
    if (data.confidenceScore !== undefined) updateData.confidenceScore = data.confidenceScore;
    if (data.note !== undefined) updateData.note = data.note;

    const result = await prisma.transaction.updateMany({
      where: { id: { in: transactionIds } },
      data: updateData,
    });

    return NextResponse.json({ success: true, affected: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error in bulk transaction operation:', error);
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 });
  }
}
