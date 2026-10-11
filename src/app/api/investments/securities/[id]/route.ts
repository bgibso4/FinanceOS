import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../../_lib/http';

const bodySchema = z.union([
  z.object({ priceSymbol: z.string().trim().min(1).max(20) }),
  z.object({ manualPrice: z.number().positive() }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(
    request,
    bodySchema,
    'Provide priceSymbol or a positive manualPrice'
  );
  if ('response' in body) return body.response;
  try {
    const { refresh } = await getInvestmentServices();
    const security =
      'priceSymbol' in body.data
        ? await refresh.setPriceSymbol(id, body.data.priceSymbol)
        : await refresh.setManualPrice(id, body.data.manualPrice);
    return NextResponse.json({ security });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to update security');
  }
}
