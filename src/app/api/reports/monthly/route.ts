import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const snapshots = await prisma.monthlySnapshot.findMany({
    orderBy: { month: 'desc' },
  });
  return NextResponse.json({
    snapshots: snapshots.map((s) => ({
      ...s,
      incomeTotal: Number(s.incomeTotal),
      spendingTotal: Number(s.spendingTotal),
      savingsTotal: Number(s.savingsTotal),
      categoryTotals: s.categoryTotals ? JSON.parse(s.categoryTotals) : {},
      merchantTotals: s.merchantTotals ? JSON.parse(s.merchantTotals) : {},
    })),
  });
}
