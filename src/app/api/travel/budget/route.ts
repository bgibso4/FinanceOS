import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/http';
import { getTravelServices } from '@/lib/travel/services';
import { travelErrorResponse } from '../_lib/http';

const budgetSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  amount: z.number().positive(),
});

/** Whether the current year has a budget yet. */
export async function GET() {
  try {
    const { budget } = await getTravelServices();
    return NextResponse.json(await budget.status());
  } catch (error) {
    return travelErrorResponse(error, 'Failed to load budget');
  }
}

export async function PUT(request: NextRequest) {
  const body = await parseJsonBody(request, budgetSchema, 'Invalid budget');
  if ('response' in body) return body.response;
  try {
    const { budget } = await getTravelServices();
    await budget.set(body.data.year, body.data.amount);
    return NextResponse.json({ success: true });
  } catch (error) {
    return travelErrorResponse(error, 'Failed to save budget');
  }
}
