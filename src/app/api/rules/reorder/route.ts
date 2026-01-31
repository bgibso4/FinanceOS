import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const reorderSchema = z.object({
  ruleIds: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ruleIds } = reorderSchema.parse(body);

    await prisma.$transaction(
      ruleIds.map((id, index) =>
        prisma.rule.update({
          where: { id },
          data: { priority: (index + 1) * 10 },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error reordering rules:', error);
    return NextResponse.json({ error: 'Failed to reorder rules' }, { status: 500 });
  }
}
