import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../../_lib/http';

const bodySchema = z.union([
  z.object({ priceSymbol: z.string().trim().min(1).max(20) }),
  z.object({ manualPrice: z.number().positive() }),
  z.object({ proxySymbol: z.string().trim().min(1).max(20).nullable() }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(
    request,
    bodySchema,
    'Provide priceSymbol, a positive manualPrice, or proxySymbol'
  );
  if ('response' in body) return body.response;
  try {
    const { refresh } = await getInvestmentServices();
    const data = body.data;
    const security =
      'priceSymbol' in data
        ? await refresh.setPriceSymbol(id, data.priceSymbol)
        : 'manualPrice' in data
          ? await refresh.setManualPrice(id, data.manualPrice)
          : await refresh.setProxy(id, data.proxySymbol);
    return NextResponse.json({ security });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to update security');
  }
}
