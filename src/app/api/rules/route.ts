import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const ruleSchema = z.object({
  matchType: z.enum(["merchantContains", "merchantRegex", "noteContains"]),
  matchValue: z.string(),
  categoryId: z.string(),
  priority: z.number().int().min(1).default(100),
  isEnabled: z.boolean().default(true)
});

export async function GET() {
  const rules = await prisma.rule.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ruleSchema.parse(body);
  const rule = await prisma.rule.create({ data: parsed });
  return NextResponse.json(rule);
}
