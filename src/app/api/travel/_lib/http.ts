import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TripNotFoundError } from '@/lib/travel/trips';

export const yearSchema = z.number().int().min(1900).max(9999);

export function travelErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof TripNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error(`[travel] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
