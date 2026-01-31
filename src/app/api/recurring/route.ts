import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getRecurringSummary, normalizeToMonthly } from '@/lib/recurring';
import { normalizeMerchant } from '@/lib/categorization';

const createSchema = z.object({
  merchantDisplay: z.string().min(1),
  merchantPattern: z.string().optional(),
  accountId: z.string(),
  categoryId: z.string().nullable().optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']),
  expectedAmount: z.number(),
  expectedDayOfMonth: z.number().min(1).max(31).nullable().optional(),
  status: z.enum(['active', 'paused', 'cancelled']).default('active'),
});

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') || undefined;
  const summary = await getRecurringSummary(prisma, accountId);
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createSchema.parse(body);

  const merchantPattern = parsed.merchantPattern || normalizeMerchant(parsed.merchantDisplay);

  // Check for existing entry
  const existing = await prisma.recurringTransaction.findUnique({
    where: {
      accountId_merchantPattern: {
        accountId: parsed.accountId,
        merchantPattern,
      },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'A recurring entry already exists for this merchant on this account' },
      { status: 409 }
    );
  }

  // Compute median interval from frequency
  const intervalMap: Record<string, number> = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    quarterly: 91,
    annual: 365,
  };

  const monthlyEquivalent = normalizeToMonthly(Math.abs(parsed.expectedAmount), parsed.frequency);
  const now = new Date();

  const recurring = await prisma.recurringTransaction.create({
    data: {
      merchantPattern,
      merchantDisplay: parsed.merchantDisplay,
      accountId: parsed.accountId,
      categoryId: parsed.categoryId ?? null,
      frequency: parsed.frequency,
      expectedAmount: parsed.expectedAmount,
      amountVariance: 0,
      expectedDayOfMonth: parsed.expectedDayOfMonth ?? null,
      medianIntervalDays: intervalMap[parsed.frequency],
      confidence: 1.0,
      intervalRegularity: 1.0,
      amountConsistency: 1.0,
      transactionCount: 0,
      firstSeenDate: now,
      lastSeenDate: now,
      status: parsed.status,
      nextExpectedDate: null,
      isManualOverride: true,
      manuallyCreated: true,
      priceHistory: JSON.stringify([
        { date: now.toISOString().split('T')[0], amount: Math.abs(parsed.expectedAmount) },
      ]),
    },
    include: {
      account: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({
    ...recurring,
    monthlyEquivalent,
    priceHistory: JSON.parse(recurring.priceHistory),
  });
}
