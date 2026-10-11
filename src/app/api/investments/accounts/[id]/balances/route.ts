import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, isoDateSchema, parseJsonBody } from '../../../_lib/http';

const bodySchema = z.object({ date: isoDateSchema, balance: z.number() });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { manualHoldings } = await getInvestmentServices();
    return NextResponse.json({ balances: await manualHoldings.list(id) });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load balances');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema, 'Invalid balance');
  if ('response' in body) return body.response;
  try {
    const { manualHoldings } = await getInvestmentServices();
    const balance = await manualHoldings.record(id, body.data);
    return NextResponse.json({ balance }, { status: 201 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to record balance');
  }
}
