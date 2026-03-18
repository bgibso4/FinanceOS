import { PrismaClient } from '@prisma/client';
import { subDays } from 'date-fns';

export async function reviewQueue(prisma: PrismaClient) {
  const sevenDaysAgo = subDays(new Date(), 7);
  const thirtyDaysAgo = subDays(new Date(), 30);
  const ninetyDaysAgo = subDays(new Date(), 90);

  const [uncategorized, lowConfidence, highConfidence, unlinkedReturns, recent] = await Promise.all(
    [
      prisma.transaction.findMany({
        where: { categoryId: null, isTransfer: false, isSplitParent: false },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.transaction.findMany({
        where: {
          confidenceScore: { lt: 0.6 },
          isTransfer: false,
          isSplitParent: false,
          categoryId: { not: null },
        },
        include: { category: true },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.transaction.findMany({
        where: {
          confidenceScore: { gte: 0.6 },
          isTransfer: false,
          isSplitParent: false,
          categoryId: { not: null },
          createdAt: { gte: sevenDaysAgo },
        },
        include: { category: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.transaction.findMany({
        where: {
          amount: { gt: 0 },
          isTransfer: false,
          isSplitParent: false,
          isOffset: false,
          linkedTransactionId: null,
          date: { gte: thirtyDaysAgo },
        },
        include: { category: true, account: true },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.transaction.findMany({
        where: {
          date: { gte: ninetyDaysAgo },
          isTransfer: false,
          isSplitParent: false,
          categoryId: { not: null },
          confidenceScore: { lt: 1.0 },
        },
        include: { category: true },
      }),
    ]
  );

  const byCategory: Record<string, number[]> = {};
  recent.forEach((tx) => {
    const key = tx.categoryId ?? 'none';
    byCategory[key] = byCategory[key] ?? [];
    byCategory[key].push(Math.abs(Number(tx.amount)));
  });

  const outliers = [];
  for (const tx of recent) {
    const series = byCategory[tx.categoryId ?? 'none'] ?? [];
    if (series.length < 5) continue; // Need at least 5 transactions to establish a pattern

    const sorted = [...series].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const txAmount = Math.abs(Number(tx.amount));

    // Flag as outlier if 3x median AND at least $50 difference
    if (txAmount > median * 3 && txAmount - median > 50) {
      outliers.push(tx);
    }
  }

  outliers.sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    uncategorized,
    lowConfidence,
    highConfidence,
    unlinkedReturns,
    outliers: outliers.slice(0, 50),
  };
}
