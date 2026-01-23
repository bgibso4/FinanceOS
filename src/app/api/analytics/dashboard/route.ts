import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { dashboardAnalytics } from '@/lib/analytics';
import { parseFilters, resolveDateRange } from '@/lib/filters';

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const filters = parseFilters(search);
  const preset = (search.get('preset') ?? 'last-3-months') as any;
  const { startDate, endDate } = resolveDateRange(preset, filters.startDate, filters.endDate);

  const payload = await dashboardAnalytics(prisma, filters, startDate, endDate);
  return NextResponse.json(payload);
}
