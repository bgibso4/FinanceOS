import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseFilters, resolveDateRange } from '@/lib/filters';
import { filterWhere, matchesTags } from '@/lib/transaction-filters';
import { TX_ROW_INCLUDE, toTxRow } from '@/lib/transaction-rows';
import { autoCategorize, normalizeMerchant } from '@/lib/categorization';

const createSchema = z.object({
  date: z.string(),
  amount: z.number(),
  accountId: z.string(),
  merchant: z.string(),
  categoryId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const filters = parseFilters(search);
  const preset = (search.get('preset') ?? 'last-3-months') as any;

  const { startDate, endDate } = resolveDateRange(preset, filters.startDate, filters.endDate);

  const where = {
    date: { gte: startDate, lte: endDate },
    isSplitParent: false,
    ...filterWhere(filters),
  };

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    include: TX_ROW_INCLUDE,
  });

  // Filter by date string to handle timezone issues
  let filtered = transactions;
  if (preset === 'custom' && (filters.startDate || filters.endDate)) {
    filtered = filtered.filter((tx) => {
      const txDateStr = tx.date.toISOString().split('T')[0]; // Get YYYY-MM-DD
      if (filters.startDate && txDateStr < filters.startDate) return false;
      if (filters.endDate && txDateStr > filters.endDate) return false;
      return true;
    });
  }

  // Tags are a JSON string column, so they are matched in JS
  filtered = filtered.filter((tx) => matchesTags(tx.tags, filters.tags));

  const shaped = filtered.map(toTxRow);

  return NextResponse.json({ transactions: shaped });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createSchema.parse(body);
  const categorization =
    parsed.categoryId !== undefined
      ? { categoryId: parsed.categoryId, confidence: 0.99 }
      : await autoCategorize(
          prisma,
          parsed.merchant,
          parsed.note ?? null,
          parsed.amount,
          parsed.accountId
        );

  // Parse date as UTC to avoid timezone issues
  const dateStr = parsed.date.split('T')[0]; // Get YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  const tx = await prisma.transaction.create({
    data: {
      date: utcDate,
      amount: parsed.amount,
      accountId: parsed.accountId,
      merchant: parsed.merchant,
      merchantNormalized: normalizeMerchant(parsed.merchant),
      note: parsed.note,
      categoryId: categorization.categoryId ?? null,
      confidenceScore: categorization.confidence,
      tags: parsed.tags ? JSON.stringify(parsed.tags) : '[]',
    },
  });
  return NextResponse.json(tx);
}
