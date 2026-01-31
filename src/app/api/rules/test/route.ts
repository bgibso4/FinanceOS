import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { normalizeMerchant } from '@/lib/categorization';
import { evaluateRule, parseConditions, type MatchInput } from '@/lib/rule-matcher';

const testSchema = z.object({
  merchant: z.string(),
  note: z.string().nullable().optional(),
  amount: z.number().optional(),
  accountId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = testSchema.parse(body);

    const rules = await prisma.rule.findMany({
      where: { isEnabled: true },
      orderBy: { priority: 'asc' },
      include: { category: true },
    });

    const input: MatchInput = {
      merchant: parsed.merchant,
      merchantNormalized: normalizeMerchant(parsed.merchant),
      note: parsed.note ?? null,
      amount: parsed.amount ?? 0,
      accountId: parsed.accountId ?? '',
    };

    let winnerCategoryId: string | null = null;
    let winnerRenameTo: string | null = null;

    const matches = [];

    for (const rule of rules) {
      const conditions = parseConditions(rule.conditions);
      if (conditions.length === 0) continue;

      if (evaluateRule(conditions, input)) {
        const isFirstCategory = !winnerCategoryId && !!rule.categoryId;
        const isFirstRename = !winnerRenameTo && !!rule.renameTo;

        if (isFirstCategory) winnerCategoryId = rule.categoryId;
        if (isFirstRename) winnerRenameTo = rule.renameTo;

        matches.push({
          rule: {
            id: rule.id,
            conditions: JSON.parse(rule.conditions),
            categoryId: rule.categoryId,
            categoryName: rule.category?.name ?? null,
            renameTo: rule.renameTo,
            description: rule.description,
            priority: rule.priority,
          },
          isWinnerCategory: isFirstCategory,
          isWinnerRename: isFirstRename,
        });
      }
    }

    // Resolve winner category name
    let winnerCategoryName: string | null = null;
    if (winnerCategoryId) {
      const cat = await prisma.category.findUnique({ where: { id: winnerCategoryId } });
      winnerCategoryName = cat?.name ?? null;
    }

    return NextResponse.json({
      matches,
      result: {
        categoryId: winnerCategoryId,
        categoryName: winnerCategoryName,
        renameTo: winnerRenameTo,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error testing rules:', error);
    return NextResponse.json({ error: 'Failed to test rules' }, { status: 500 });
  }
}
