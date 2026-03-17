import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const unsplitSchema = z.object({
  transactionId: z.string(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = unsplitSchema.parse(body);

  const parent = await prisma.transaction.findUniqueOrThrow({
    where: { id: parsed.transactionId },
  });

  if (!parent.isSplitParent) {
    return NextResponse.json({ error: 'Transaction is not a split parent.' }, { status: 400 });
  }

  const restored = await prisma.$transaction(async (tx) => {
    // Delete all split parts
    await tx.transaction.deleteMany({
      where: { parentTransactionId: parent.id },
    });

    // Restore parent
    return tx.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: false },
    });
  });

  return NextResponse.json(restored);
}
