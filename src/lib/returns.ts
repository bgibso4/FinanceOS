import { PrismaClient } from "@prisma/client";
import { subDays } from "date-fns";

export async function findPotentialReturns(
  prisma: PrismaClient,
  transactionId: string
) {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { account: true }
  });

  if (!transaction) return [];

  console.log('Finding matches for:', {
    merchant: transaction.merchant,
    merchantNormalized: transaction.merchantNormalized,
    amount: transaction.amount,
    date: transaction.date
  });

  // Returns/offsets are typically:
  // - Opposite sign (credit for debit, or vice versa)
  // - Same or similar merchant
  // - Within 180 days
  const isOriginalPurchase = transaction.amount < 0;
  
  // Search 180 days in both directions for more flexibility
  const startDate = subDays(transaction.date, 180);
  const endDate = new Date(transaction.date.getTime() + 180 * 24 * 60 * 60 * 1000);

  // Get the first significant word from merchant name for fuzzy matching
  const merchantWords = transaction.merchantNormalized.split(' ').filter(w => w.length > 3);
  const primaryMerchant = merchantWords[0] || transaction.merchantNormalized;

  console.log('Search params:', {
    primaryMerchant,
    merchantWords,
    startDate,
    endDate,
    accountId: transaction.accountId
  });

  // First try: exact merchant match with opposite sign (most likely returns)
  const exactMatches = await prisma.transaction.findMany({
    where: {
      accountId: transaction.accountId,
      merchantNormalized: transaction.merchantNormalized,
      date: {
        gte: startDate,
        lte: endDate
      },
      id: { not: transactionId },
      isOffset: false,
      linkedTransactionId: null,
      amount: isOriginalPurchase ? { gt: 0 } : { lt: 0 }
    },
    orderBy: [
      { date: 'desc' }
    ],
    take: 10
  });

  console.log('Exact matches:', exactMatches.length);

  // Second try: fuzzy merchant match with opposite sign
  const fuzzyMatches = await prisma.transaction.findMany({
    where: {
      accountId: transaction.accountId,
      merchantNormalized: { contains: primaryMerchant },
      date: {
        gte: startDate,
        lte: endDate
      },
      id: { not: transactionId },
      isOffset: false,
      linkedTransactionId: null,
      amount: isOriginalPurchase ? { gt: 0 } : { lt: 0 }
    },
    orderBy: [
      { date: 'desc' }
    ],
    take: 20
  });

  console.log('Fuzzy matches:', fuzzyMatches.length);

  // Third try: same merchant, any sign (for linking related transactions)
  const sameSignMatches = await prisma.transaction.findMany({
    where: {
      accountId: transaction.accountId,
      merchantNormalized: { contains: primaryMerchant },
      date: {
        gte: startDate,
        lte: endDate
      },
      id: { not: transactionId },
      isOffset: false,
      linkedTransactionId: null
    },
    orderBy: [
      { date: 'desc' }
    ],
    take: 10
  });

  console.log('Same sign matches:', sameSignMatches.length);

  // Fourth try: if still no matches, search by amount similarity only (very broad)
  let amountMatches: any[] = [];
  if (exactMatches.length === 0 && fuzzyMatches.length === 0 && sameSignMatches.length === 0) {
    const targetAmount = Math.abs(transaction.amount);
    const minAmount = targetAmount * 0.8; // Within 20% of amount
    const maxAmount = targetAmount * 1.2;
    
    amountMatches = await prisma.transaction.findMany({
      where: {
        accountId: transaction.accountId,
        date: {
          gte: startDate,
          lte: endDate
        },
        id: { not: transactionId },
        isOffset: false,
        linkedTransactionId: null,
        amount: isOriginalPurchase 
          ? { gte: minAmount, lte: maxAmount } // Positive amounts
          : { gte: -maxAmount, lte: -minAmount } // Negative amounts
      },
      orderBy: [
        { date: 'desc' }
      ],
      take: 15
    });
    
    console.log('Amount-based matches:', amountMatches.length);
  }

  // Combine and deduplicate
  const allMatches = [...exactMatches, ...fuzzyMatches, ...sameSignMatches, ...amountMatches];
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [m.id, m])).values()
  );

  console.log('Total unique matches:', uniqueMatches.length);

  // Score matches by amount similarity and date proximity
  const scored = uniqueMatches.map(match => {
    const amountDiff = Math.abs(Math.abs(match.amount) - Math.abs(transaction.amount));
    const amountScore = Math.max(0, 1 - (amountDiff / Math.abs(transaction.amount)));
    
    const daysDiff = Math.abs(match.date.getTime() - transaction.date.getTime()) / (1000 * 60 * 60 * 24);
    const dateScore = Math.max(0, 1 - (daysDiff / 180));
    
    // Merchant similarity score
    const matchWords = match.merchantNormalized.split(' ').filter((w: string) => w.length > 3);
    const commonWords = merchantWords.filter((w: string) => matchWords.includes(w)).length;
    const merchantScore = commonWords / Math.max(merchantWords.length, matchWords.length, 1);
    
    // Exact merchant match bonus
    const exactMerchantBonus = match.merchantNormalized === transaction.merchantNormalized ? 0.2 : 0;
    
    // Opposite sign bonus (more likely to be a return)
    const oppositeSignBonus = (match.amount > 0) !== (transaction.amount > 0) ? 0.1 : 0;
    
    const totalScore = (amountScore * 0.4) + (dateScore * 0.2) + (merchantScore * 0.2) + exactMerchantBonus + oppositeSignBonus;
    
    return {
      ...match,
      score: totalScore,
      amountDiff,
      daysDiff: Math.round(daysDiff)
    };
  });

  const results = scored
    .filter(m => m.score > 0.05) // Even lower threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  console.log('Final results:', results.length, results.map(r => ({ merchant: r.merchant, score: r.score })));

  return results;
}

export async function linkReturn(
  prisma: PrismaClient,
  returnTransactionId: string,
  originalTransactionId: string
) {
  // Mark the return transaction
  await prisma.transaction.update({
    where: { id: returnTransactionId },
    data: {
      isOffset: true,
      linkedTransactionId: originalTransactionId
    }
  });

  return { success: true };
}

export async function unlinkReturn(
  prisma: PrismaClient,
  returnTransactionId: string
) {
  await prisma.transaction.update({
    where: { id: returnTransactionId },
    data: {
      isOffset: false,
      linkedTransactionId: null
    }
  });

  return { success: true };
}
