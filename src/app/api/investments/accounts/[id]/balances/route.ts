import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isoDay } from '@/lib/investments/dates';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, isoDateSchema, parseJsonBody } from '../../../_lib/http';

const single = z.object({ date: isoDateSchema, balance: z.number() });
const bodySchema = z.union([single, z.object({ balances: z.array(single).min(1).max(1000) })]);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { enteredBalances } = await getInvestmentServices();
    const { balances, enterBefore } = await enteredBalances.list(id);
    return NextResponse.json({
      balances,
      enterBefore: enterBefore ? isoDay(enterBefore) : null,
      today: enteredBalances.today(),
    });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load balances');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema, 'Invalid balance');
  if ('response' in body) return body.response;
  try {
    const { enteredBalances } = await getInvestmentServices();
    if ('balances' in body.data) {
      return NextResponse.json(await enteredBalances.recordMany(id, body.data.balances));
    }
    const balance = await enteredBalances.record(id, body.data);
    return NextResponse.json({ balance }, { status: 201 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to record balance');
  }
}
