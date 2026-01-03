import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const splitSchema = z.object({
  transactionId: z.string(),
  parts: z
    .array(
      z.object({
        amount: z.number(),
        categoryId: z.string().nullable().optional(),
        note: z.string().optional()
      })
    )
    .min(2)
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = splitSchema.parse(body);

  const parent = await prisma.transaction.findUniqueOrThrow({ where: { id: parsed.transactionId } });

  const created = await prisma.$transaction(async (tx) => {
    await tx.transaction.delete({ where: { id: parent.id } });
    return Promise.all(
      parsed.parts.map((part) =>
        tx.transaction.create({
          data: {
            date: parent.date,
            amount: part.amount,
            accountId: parent.accountId,
            merchant: parent.merchant,
            categoryId: part.categoryId ?? null,
            note: part.note ?? parent.note,
            tags: parent.tags,
            isTransfer: parent.isTransfer,
            confidenceScore: parent.confidenceScore
          }
        })
      )
    );
  });

  return NextResponse.json({ parts: created });
}
