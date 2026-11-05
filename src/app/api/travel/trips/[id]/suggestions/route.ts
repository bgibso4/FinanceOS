import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/http';
import { getTravelServices } from '@/lib/travel/services';
import { travelErrorResponse } from '../../../_lib/http';

type Params = { params: Promise<{ id: string }> };

const assignSchema = z.object({ add: z.array(z.string()), dismiss: z.array(z.string()) });

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const { suggester, trips } = await getTravelServices();
    await trips.require(id);
    return NextResponse.json({ suggestions: await suggester.suggest(id) });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to load suggestions');
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await parseJsonBody(request, assignSchema, 'Invalid assignment');
  if ('response' in body) return body.response;
  try {
    const { trips } = await getTravelServices();
    return NextResponse.json(await trips.assign(id, body.data));
  } catch (error) {
    return travelErrorResponse(error, 'Failed to assign transactions');
  }
}
