import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  institution: z.string().optional(),
  currency: z.string().default("USD"),
  isActive: z.boolean().default(true),
  notes: z.string().optional()
});

export async function GET() {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = accountSchema.parse(body);
  const account = await prisma.account.create({ data: parsed });
  return NextResponse.json(account);
}
