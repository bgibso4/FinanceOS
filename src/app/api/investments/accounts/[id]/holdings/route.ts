import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../../../_lib/http';

const bodySchema = z.object({
  holdings: z.array(z.object({ securityId: z.string().min(1), quantity: z.number() })),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { overview } = await getInvestmentServices();
    return NextResponse.json(await overview.accountHoldings(id));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load holdings');
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema, 'Invalid holdings');
  if ('response' in body) return body.response;
  try {
    const { refresh } = await getInvestmentServices();
    return NextResponse.json(await refresh.saveHoldings(id, body.data.holdings));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to save holdings');
  }
}
