import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { importCsv } from '@/lib/import';
import { detectRecurringTransactions, syncDetectedRecurring } from '@/lib/recurring';

const schema = z.object({
  csv: z.string(),
  mapping: z.object({
    date: z.string(),
    amount: z.string(),
    merchant: z.string(),
    note: z.string().optional(),
  }),
  accountId: z.string(),
  invertAmounts: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.parse(body);
  const result = await importCsv(
    prisma,
    parsed.csv,
    parsed.mapping,
    parsed.accountId,
    parsed.invertAmounts
  );

  // Run recurring transaction detection for this account after import
  try {
    const detected = await detectRecurringTransactions(prisma, parsed.accountId);
    const recurringResult = await syncDetectedRecurring(prisma, detected);
    return NextResponse.json({
      ...result,
      recurringUpdated: recurringResult,
    });
  } catch (_err) {
    // Non-critical — return import result even if detection fails
    return NextResponse.json(result);
  }
}
