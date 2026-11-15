import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse } from '../../_lib/http';

const MAX_AMOUNT = 1e9;

const querySchema = z.object({
  amount: z.coerce.number().finite().min(0).max(MAX_AMOUNT),
  sells: z.boolean(),
});

/** What to buy (and sell) to move toward the investing targets. Nothing is saved. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    amount: params.get('amount') || '0',
    sells: params.get('sells') === '1',
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  try {
    const { planner } = await getInvestmentServices();
    return NextResponse.json(await planner.plan(parsed.data));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to plan investments');
  }
}
