import { NextRequest, NextResponse } from 'next/server';
import { getTravelServices } from '@/lib/travel/services';
import { travelErrorResponse, yearSchema } from './_lib/http';

/** One year of Travel: its trips, totals and budget. */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('year');
  const year = raw === null ? new Date().getUTCFullYear() : Number(raw);
  if (!yearSchema.safeParse(year).success) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }
  try {
    const { totals, budget } = await getTravelServices();
    const [view, set] = await Promise.all([totals.year(year), budget.get(year)]);
    return NextResponse.json({
      view,
      budget: set ? { target: set.target, spent: set.spent } : null,
    });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to load travel');
  }
}
