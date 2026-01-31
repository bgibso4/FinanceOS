import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { detectRecurringTransactions, syncDetectedRecurring } from '@/lib/recurring';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const accountId = body.accountId as string | undefined;

  const detected = await detectRecurringTransactions(prisma, accountId);
  const result = await syncDetectedRecurring(prisma, detected);

  return NextResponse.json({
    detected: detected.length,
    ...result,
  });
}
