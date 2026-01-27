import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const reorderSchema = z.object({
  accountIds: z.array(z.string().uuid()),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountIds } = reorderSchema.parse(body);

    // Update each account's sortOrder based on its position in the array
    await prisma.$transaction(
      accountIds.map((id, index) =>
        prisma.account.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error reordering accounts:', error);
    return NextResponse.json({ error: 'Failed to reorder accounts' }, { status: 500 });
  }
}
