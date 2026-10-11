import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isoDay, utcDay } from '@/lib/investments/dates';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { PriceProviderError } from '@/lib/prices/types';

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => isoDay(utcDay(s)) === s, 'Invalid date');

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
  error: string
): Promise<{ data: T } | { response: NextResponse }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return {
    response: NextResponse.json({ error, details: parsed.error.issues }, { status: 400 }),
  };
}

export function investmentErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof InvestmentInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PriceProviderError) {
    const status = error.kind === 'unknown_symbol' ? 400 : 502;
    const message =
      error.kind === 'unknown_symbol' ? 'Unknown symbol' : 'Price service unavailable';
    return NextResponse.json({ error: message }, { status });
  }
  console.error(`[investments] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
