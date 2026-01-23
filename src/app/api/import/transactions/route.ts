import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { importCsv } from '@/lib/import';

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
  return NextResponse.json(result);
}
