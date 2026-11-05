import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { TX_ROW_INCLUDE, toTxRow } from '@/lib/transaction-rows';
import { getTravelServices } from '@/lib/travel/services';
import { tripInputSchema } from '@/lib/travel/trips';
import { travelErrorResponse } from '../../_lib/http';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const { totals, suggester } = await getTravelServices();
    const trip = await totals.trip(id);
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    const [rows, suggestionCount] = await Promise.all([
      prisma.transaction.findMany({
        where: { tripId: id, isSplitParent: false },
        include: TX_ROW_INCLUDE,
        orderBy: { date: 'desc' },
      }),
      suggester.count(id),
    ]);
    return NextResponse.json({ trip, transactions: rows.map(toTxRow), suggestionCount });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to load trip');
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await parseJsonBody(request, tripInputSchema, 'Invalid trip');
  if ('response' in body) return body.response;
  try {
    const { trips } = await getTravelServices();
    return NextResponse.json(await trips.update(id, body.data));
  } catch (error) {
    return travelErrorResponse(error, 'Failed to update trip');
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const { trips } = await getTravelServices();
    await trips.remove(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to delete trip');
  }
}
