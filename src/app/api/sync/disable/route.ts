import { NextResponse } from 'next/server';

export async function POST() {
  // Disabling sync is handled client-side (clearing local storage)
  // This endpoint is just for confirmation and logging

  return NextResponse.json({
    success: true,
    disabledAt: new Date().toISOString(),
    message:
      'Cloud sync disabled. Local data preserved. Cloud data remains accessible with your sync ID.',
  });
}
