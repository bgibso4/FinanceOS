import { NextRequest, NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse } from '../../_lib/http';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  try {
    const { catalog } = await getInvestmentServices();
    return NextResponse.json({ results: await catalog.search(q) });
  } catch (error) {
    return investmentErrorResponse(error, 'Search failed');
  }
}
