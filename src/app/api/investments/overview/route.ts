import { NextRequest, NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { DEFAULT_RANGE, isRange } from '@/lib/investments/portfolio-view';
import { investmentErrorResponse } from '../_lib/http';

/** Everything the investments page shows for one range. */
export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get('range') ?? DEFAULT_RANGE;
  if (!isRange(range)) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  try {
    const { overview } = await getInvestmentServices();
    return NextResponse.json(await overview.load(range));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load investments');
  }
}
