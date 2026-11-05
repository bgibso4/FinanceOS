import { NextResponse } from 'next/server';
import { TripNotFoundError } from '@/lib/travel/trips';

export function travelErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof TripNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error(`[travel] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
