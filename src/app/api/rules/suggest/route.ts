import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAIConfigured, suggestRules, type MerchantGroup } from '@/lib/ai';
import { LOW_CONFIDENCE_THRESHOLD } from '@/lib/categorization';

export async function POST() {
  try {
    if (!isAIConfigured()) {
      return NextResponse.json({
        suggestions: [],
        message:
          'AI is not configured. Add OPENAI_API_KEY to your .env file to enable rule suggestions.',
      });
    }

    // Find uncategorized/low-confidence transactions from the last 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const transactions = await prisma.transaction.findMany({
      where: {
        date: { gte: threeMonthsAgo },
        OR: [{ categoryId: null }, { confidenceScore: { lt: LOW_CONFIDENCE_THRESHOLD } }],
      },
      select: {
        merchant: true,
        merchantNormalized: true,
        amount: true,
        accountId: true,
        account: { select: { name: true } },
      },
    });

    if (transactions.length === 0) {
      return NextResponse.json({
        suggestions: [],
        message: 'No uncategorized transactions found. Your rules are working well!',
      });
    }

    // Group by merchantNormalized
    const groups = new Map<string, MerchantGroup>();
    for (const tx of transactions) {
      const key = tx.merchantNormalized || tx.merchant.toLowerCase();
      const group = groups.get(key) || {
        merchantNormalized: key,
        rawMerchants: [],
        transactionCount: 0,
        avgAmount: 0,
        accountNames: [],
      };

      group.transactionCount++;
      group.avgAmount += tx.amount;
      if (!group.rawMerchants.includes(tx.merchant)) {
        group.rawMerchants.push(tx.merchant);
      }
      if (tx.account && !group.accountNames.includes(tx.account.name)) {
        group.accountNames.push(tx.account.name);
      }

      groups.set(key, group);
    }

    // Only suggest for merchants with 3+ transactions
    const frequentMerchants = Array.from(groups.values())
      .filter((g) => g.transactionCount >= 3)
      .map((g) => ({ ...g, avgAmount: g.avgAmount / g.transactionCount }))
      .sort((a, b) => b.transactionCount - a.transactionCount);

    if (frequentMerchants.length === 0) {
      return NextResponse.json({
        suggestions: [],
        message:
          'No merchants with enough uncategorized transactions to suggest rules (need 3+ transactions per merchant).',
      });
    }

    // Load categories with groups
    const categories = await prisma.category.findMany({
      include: { parent: true },
    });

    const categoryInfo = categories.map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.parent?.name ?? null,
    }));

    const suggestions = await suggestRules(frequentMerchants, categoryInfo);

    // Enrich suggestions with transaction counts
    const enriched = suggestions.map((s) => {
      const matchValue = s.conditions[0]?.value?.toLowerCase() || '';
      const matchingCount = transactions.filter((tx) =>
        tx.merchant.toLowerCase().includes(matchValue)
      ).length;

      const matchingSample = transactions
        .filter((tx) => tx.merchant.toLowerCase().includes(matchValue))
        .slice(0, 5)
        .map((tx) => ({
          merchant: tx.merchant,
          amount: tx.amount,
        }));

      return {
        ...s,
        matchingTransactionCount: matchingCount,
        sampleTransactions: matchingSample,
      };
    });

    return NextResponse.json({ suggestions: enriched });
  } catch (error) {
    console.error('Error suggesting rules:', error);
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 });
  }
}
