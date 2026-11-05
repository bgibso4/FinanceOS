import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/http';
import { getTravelServices } from '@/lib/travel/services';
import { tripInputSchema } from '@/lib/travel/trips';
import { travelErrorResponse } from '../_lib/http';

export async function GET() {
  try {
    const { trips } = await getTravelServices();
    return NextResponse.json({ trips: await trips.list() });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to load trips');
  }
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, tripInputSchema, 'Invalid trip');
  if ('response' in body) return body.response;
  try {
    const { trips } = await getTravelServices();
    return NextResponse.json(await trips.create(body.data), { status: 201 });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to create trip');
  }
}
