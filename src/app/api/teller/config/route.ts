import { NextResponse } from 'next/server';
import { getTellerApplicationId } from '@/lib/teller';

export async function GET() {
  try {
    const applicationId = getTellerApplicationId();
    const environment = process.env.TELLER_ENV || 'sandbox';

    return NextResponse.json({
      applicationId,
      environment,
    });
  } catch (error: unknown) {
    console.error('Error getting Teller config:', error);
    const message = error instanceof Error ? error.message : 'Failed to get Teller config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
