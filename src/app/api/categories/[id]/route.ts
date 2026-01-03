import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  parentId: z.string().optional().nullable()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.parse(body);
  const category = await prisma.category.update({
    where: { id },
    data: parsed
  });
  return NextResponse.json(category);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  try {
    // Check if category has transactions
    const transactionCount = await prisma.transaction.count({
      where: { categoryId: id }
    });
    
    if (transactionCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category with ${transactionCount} transactions.` },
        { status: 400 }
      );
    }

    // Check if category has rules
    const ruleCount = await prisma.rule.count({
      where: { categoryId: id }
    });
    
    if (ruleCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category with ${ruleCount} automation rules. Delete the rules first.` },
        { status: 400 }
      );
    }

    await prisma.category.delete({
      where: { id }
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete category" },
      { status: 500 }
    );
  }
}