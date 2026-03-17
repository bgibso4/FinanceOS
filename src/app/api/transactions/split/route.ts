import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const splitSchema = z.object({
  transactionId: z.string(),
  parts: z
    .array(
      z.object({
        amount: z.number(),
        categoryId: z.string().nullable().optional(),
        note: z.string().optional(),
      })
    )
    .min(2),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = splitSchema.parse(body);

  const parent = await prisma.transaction.findUniqueOrThrow({
    where: { id: parsed.transactionId },
    include: { offsetTransactions: true },
  });

  // Validation: cannot split a parent or a part
  if (parent.isSplitParent) {
    return NextResponse.json(
      { error: 'Transaction is already split. Unsplit first to re-split.' },
      { status: 400 }
    );
  }
  if (parent.parentTransactionId) {
    return NextResponse.json(
      { error: 'Cannot split a split part. Unsplit the parent first.' },
      { status: 400 }
    );
  }

  // Validation: cannot split linked/offset transactions
  if (parent.linkedTransactionId || parent.offsetTransactions.length > 0) {
    return NextResponse.json(
      { error: 'Cannot split a transaction with linked returns. Unlink first.' },
      { status: 400 }
    );
  }

  // Validation: parts must sum to parent amount exactly
  const partsSum = parsed.parts.reduce((sum, p) => sum + p.amount, 0);
  if (Math.abs(partsSum - parent.amount) > 0.001) {
    return NextResponse.json(
      {
        error: `Split parts must sum to ${parent.amount}. Current sum: ${partsSum}`,
      },
      { status: 400 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    // Mark parent as split
    await tx.transaction.update({
      where: { id: parent.id },
      data: { isSplitParent: true },
    });

    // Create split parts
    return Promise.all(
      parsed.parts.map((part) =>
        tx.transaction.create({
          data: {
            date: parent.date,
            amount: part.amount,
            accountId: parent.accountId,
            merchant: parent.merchant,
            merchantNormalized: parent.merchantNormalized,
            categoryId: part.categoryId ?? null,
            note: part.note ?? null,
            tags: parent.tags,
            isTransfer: parent.isTransfer,
            confidenceScore: 1.0,
            parentTransactionId: parent.id,
          },
        })
      )
    );
  });

  return NextResponse.json({ parts: created });
}
