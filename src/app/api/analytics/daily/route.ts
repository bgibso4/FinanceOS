import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { spendingByDay } from '@/lib/analytics';
import { compareRange, parseFilters, resolveDateRange } from '@/lib/filters';

/** Net spend per day and category for the period, and for the comparison when one is asked. */
export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const filters = parseFilters(search);
  const { startDate, endDate } = resolveDateRange('custom', filters.startDate, filters.endDate);
  const compare = compareRange(search);

  const [current, compareDays] = await Promise.all([
    spendingByDay(prisma, filters, startDate, endDate),
    compare ? spendingByDay(prisma, filters, compare.startDate, compare.endDate) : null,
  ]);
  return NextResponse.json({ current, compare: compareDays });
}
