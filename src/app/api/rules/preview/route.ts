import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { normalizeMerchant } from '@/lib/categorization';
import { evaluateRule, type Condition, type MatchInput } from '@/lib/rule-matcher';

const conditionSchema = z.object({
  field: z.enum(['merchant', 'merchantNormalized', 'note', 'amount', 'account']),
  operator: z.enum(['contains', 'exact', 'regex', 'gt', 'lt', 'between', 'equals']),
  value: z.string(),
  negate: z.boolean().optional(),
});

const previewSchema = z.object({
  conditions: z.array(conditionSchema).min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = previewSchema.parse(body);

    // Fetch recent transactions (last 6 months) for performance
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const transactions = await prisma.transaction.findMany({
      where: { date: { gte: sixMonthsAgo }, isSplitParent: false },
      select: {
        id: true,
        merchant: true,
        merchantNormalized: true,
        note: true,
        amount: true,
        accountId: true,
        date: true,
      },
      orderBy: { date: 'desc' },
    });

    const conditions = parsed.conditions as Condition[];
    const matchingTransactions = [];

    for (const tx of transactions) {
      const input: MatchInput = {
        merchant: tx.merchant,
        merchantNormalized: tx.merchantNormalized || normalizeMerchant(tx.merchant),
        note: tx.note,
        amount: tx.amount,
        accountId: tx.accountId,
      };

      if (evaluateRule(conditions, input)) {
        matchingTransactions.push(tx);
      }
    }

    return NextResponse.json({
      matchCount: matchingTransactions.length,
      sampleTransactions: matchingTransactions.slice(0, 5).map((tx) => ({
        id: tx.id,
        merchant: tx.merchant,
        amount: tx.amount,
        date: tx.date,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error previewing rule:', error);
    return NextResponse.json({ error: 'Failed to preview rule' }, { status: 500 });
  }
}
