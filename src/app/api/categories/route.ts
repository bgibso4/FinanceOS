import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const categorySchema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional().nullable(),
  type: z.enum(["income", "expense", "transfer"])
});

export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" }
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = categorySchema.parse(body);
  const category = await prisma.category.create({ data: parsed });
  return NextResponse.json(category);
}
