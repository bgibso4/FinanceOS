import { NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { isoDay } from '@/lib/investments/dates';
import { investmentErrorResponse } from '../_lib/http';

export async function POST() {
  try {
    const { refresh, prices } = await getInvestmentServices();
    const result = await refresh.refresh();
    const freshness = await prices.freshness();
    return NextResponse.json({
      ...result,
      pricesAsOf: freshness.asOf ? isoDay(freshness.asOf) : null,
    });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to refresh investments');
  }
}
