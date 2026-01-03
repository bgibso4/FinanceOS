import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  institution: z.string().optional().nullable(),
  currency: z.string().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.parse(body);
  const account = await prisma.account.update({
    where: { id },
    data: parsed
  });
  return NextResponse.json(account);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  try {
    // Check if account has transactions
    const transactionCount = await prisma.transaction.count({
      where: { accountId: id }
    });
    
    if (transactionCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete account with ${transactionCount} transactions. Archive it instead.` },
        { status: 400 }
      );
    }

    await prisma.account.delete({
      where: { id }
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}
