import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reviewQueue } from '@/lib/reviewQueue';

export async function GET() {
  const data = await reviewQueue(prisma);
  return NextResponse.json({
    uncategorized: data.uncategorized.map((t) => ({ ...t, amount: Number(t.amount) })),
    lowConfidence: data.lowConfidence.map((t) => ({ ...t, amount: Number(t.amount) })),
    outliers: data.outliers.map((t) => ({ ...t, amount: Number(t.amount) })),
  });
}
