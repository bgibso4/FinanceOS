import { NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';

export async function POST() {
  try {
    const { fxRates } = await getInvestmentServices();
    return NextResponse.json(await fxRates.fill());
  } catch (error) {
    console.error('Failed to refresh exchange rates:', error);
    return NextResponse.json({ error: 'Failed to refresh exchange rates' }, { status: 500 });
  }
}
