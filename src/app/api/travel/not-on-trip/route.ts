import { NextRequest, NextResponse } from 'next/server';
import { getTravelServices } from '@/lib/travel/services';
import { travelErrorResponse } from '../_lib/http';

/** The transactions behind a year's "Not on a trip" figure. */
export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get('year'));
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }
  try {
    const { totals } = await getTravelServices();
    return NextResponse.json({ transactions: await totals.notOnTripTransactions(year) });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to load transactions');
  }
}
