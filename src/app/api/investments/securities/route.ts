import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../_lib/http';

const bodySchema = z.object({ symbol: z.string().trim().min(1).max(20) });

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema, 'Symbol is required');
  if ('response' in body) return body.response;
  try {
    const { catalog } = await getInvestmentServices();
    const { security, created } = await catalog.findOrCreateFeed(body.data.symbol);
    return NextResponse.json({ security }, { status: created ? 201 : 200 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to add security');
  }
}
