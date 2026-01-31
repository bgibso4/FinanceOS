import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().default('blue'),
});

export async function GET(req: NextRequest) {
  const tags = await prisma.tag.findMany({
    orderBy: { name: 'asc' },
  });

  const withCounts = req.nextUrl.searchParams.get('withCounts') === 'true';

  if (withCounts) {
    const transactions = await prisma.transaction.findMany({
      where: { tags: { not: null } },
      select: { tags: true },
    });

    const countMap: Record<string, number> = {};
    transactions.forEach((tx) => {
      const txTags: string[] = JSON.parse(tx.tags!);
      txTags.forEach((t) => {
        countMap[t] = (countMap[t] || 0) + 1;
      });
    });

    return NextResponse.json({
      tags: tags.map((t) => ({ ...t, transactionCount: countMap[t.name] || 0 })),
    });
  }

  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createTagSchema.parse(body);

  const existing = await prisma.tag.findFirst({
    where: { name: parsed.name },
  });
  if (existing) {
    return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
  }

  const tag = await prisma.tag.create({ data: parsed });
  return NextResponse.json(tag);
}
