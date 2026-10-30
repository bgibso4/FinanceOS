import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../_lib/http';

const bodySchema = z.union([
  z.object({ symbol: z.string().trim().min(1).max(20) }),
  z.object({ cash: z.string().trim().length(3) }),
]);

/** Every security investment accounts hold or traded, with how it's priced (Settings → Securities). */
export async function GET() {
  try {
    const { securityList } = await getInvestmentServices();
    return NextResponse.json(await securityList.list());
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load securities');
  }
}

/** Add a security by ticker (validated by a live quote) or get the cash security for a currency. */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema, 'Symbol or cash currency is required');
  if ('response' in body) return body.response;
  try {
    const { catalog } = await getInvestmentServices();
    if ('cash' in body.data) {
      return NextResponse.json({ security: await catalog.findOrCreateCash(body.data.cash) });
    }
    const { security, created } = await catalog.findOrCreateMarket(body.data.symbol);
    return NextResponse.json({ security }, { status: created ? 201 : 200 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to add security');
  }
}
