import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseFilters, resolveDateRange } from '@/lib/filters';
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

  console.log('GET /api/transactions - Raw params:', {
    preset,
    startDate: search.get('startDate'),
    endDate: search.get('endDate'),
    filters,
  });

  const { startDate, endDate } = resolveDateRange(preset, filters.startDate, filters.endDate);

  console.log('Transaction API filtering:', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    filters,
  });

  const where: any = {
    date: { gte: startDate, lte: endDate },
  };
  if (filters.accounts) where.accountId = { in: filters.accounts };
  if (filters.categories) where.categoryId = { in: filters.categories };
  if (filters.merchant) where.merchant = { contains: filters.merchant };
  // Note: tags are stored as JSON strings in SQLite (not native arrays),
  // so we filter them in JS after the query instead of using Prisma filters.
  if (filters.tags) where.tags = { not: null };

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      category: true,
      account: true,
      linkedTransaction: true,
      offsetTransactions: true,
    },
  });

  console.log(
    'Found transactions:',
    transactions.length,
    'First few dates:',
    transactions.slice(0, 3).map((t) => t.date.toISOString())
  );

  // Filter by date string to handle timezone issues
  let filtered = transactions;
  if (preset === 'custom' && (filters.startDate || filters.endDate)) {
    filtered = filtered.filter((tx) => {
      const txDateStr = tx.date.toISOString().split('T')[0]; // Get YYYY-MM-DD
      if (filters.startDate && txDateStr < filters.startDate) return false;
      if (filters.endDate && txDateStr > filters.endDate) return false;
      return true;
    });
    console.log('After date string filtering:', filtered.length);
  }

  // Filter by tags (JSON string field, filtered in JS)
  if (filters.tags) {
    filtered = filtered.filter((tx) => {
      if (!tx.tags) return false;
      try {
        const txTags: string[] = JSON.parse(tx.tags);
        return filters.tags!.every((t) => txTags.includes(t));
      } catch {
        return false;
      }
    });
  }

  const shaped = filtered.map((tx) => ({
    ...tx,
    amount: Number(tx.amount),
    tags: tx.tags ? JSON.parse(tx.tags) : [],
  }));

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
