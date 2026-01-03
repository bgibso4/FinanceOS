import { PrismaClient } from "@prisma/client";
import { subDays } from "date-fns";

export async function reviewQueue(prisma: PrismaClient) {
  const uncategorized = await prisma.transaction.findMany({
    where: { categoryId: null, isTransfer: false },
    orderBy: { date: "desc" },
    take: 50
  });

  const lowConfidence = await prisma.transaction.findMany({
    where: { 
      confidenceScore: { lt: 0.6 }, 
      isTransfer: false,
      categoryId: { not: null } // Must have a category assigned
    },
    include: { category: true },
    orderBy: { date: "desc" },
    take: 50
  });

  // High confidence transactions from the last 7 days (for review)
  const sevenDaysAgo = subDays(new Date(), 7);
  const highConfidence = await prisma.transaction.findMany({
    where: { 
      confidenceScore: { gte: 0.6 }, 
      isTransfer: false,
      categoryId: { not: null },
      createdAt: { gte: sevenDaysAgo }
    },
    include: { category: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  // Unlinked returns - positive amounts that might be returns
  const thirtyDaysAgo = subDays(new Date(), 30);
  const unlinkedReturns = await prisma.transaction.findMany({
    where: {
      amount: { gt: 0 },
      isTransfer: false,
      isOffset: false, // Not yet marked as an offset
      linkedTransactionId: null,
      date: { gte: thirtyDaysAgo }
    },
    include: { category: true, account: true },
    orderBy: { date: "desc" },
    take: 50
  });

  const ninetyDaysAgo = subDays(new Date(), 90);
  const recent = await prisma.transaction.findMany({
    where: { 
      date: { gte: ninetyDaysAgo }, 
      isTransfer: false,
      categoryId: { not: null }, // Only categorized transactions can be outliers
      confidenceScore: { lt: 1.0 } // Exclude manually confirmed transactions
    },
    include: { category: true }
  });

  const byCategory: Record<string, number[]> = {};
  recent.forEach((tx) => {
    const key = tx.categoryId ?? "none";
    byCategory[key] = byCategory[key] ?? [];
    byCategory[key].push(Math.abs(Number(tx.amount)));
  });

  const outliers = [];
  for (const tx of recent) {
    const series = byCategory[tx.categoryId ?? "none"] ?? [];
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
    outliers: outliers.slice(0, 50)
  };
}
