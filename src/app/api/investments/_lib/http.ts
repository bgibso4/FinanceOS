import { NextResponse } from 'next/server';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { PriceProviderError, type PriceErrorKind } from '@/lib/prices/types';

const PRICE_SERVICE_DOWN = { status: 502, message: 'Price service unavailable' };
const PRICE_ERROR_RESPONSES: Record<PriceErrorKind, { status: number; message: string }> = {
  unknown_symbol: { status: 400, message: 'Unknown symbol' },
  rate_limited: PRICE_SERVICE_DOWN,
  network: PRICE_SERVICE_DOWN,
  bad_response: PRICE_SERVICE_DOWN,
};

export function investmentErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof InvestmentInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PriceProviderError) {
    const { status, message } = PRICE_ERROR_RESPONSES[error.kind];
    return NextResponse.json({ error: message }, { status });
  }
  console.error(`[investments] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
