import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Get all active accounts with their transactions
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: {
      transactions: {
        select: { amount: true, isTransfer: true }
      }
    }
  });

  // Calculate balance for each account
  const accountBalances = accounts.map(account => {
    const balance = account.transactions.reduce((sum, tx) => sum + tx.amount, 0);
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      institution: account.institution,
      balance
    };
  });

  // Calculate totals by type
  const totalsByType: Record<string, number> = {};
  accountBalances.forEach(acc => {
    totalsByType[acc.type] = (totalsByType[acc.type] ?? 0) + acc.balance;
  });

  // Net worth = assets - liabilities
  // Assets: checking, savings, brokerage, retirement, crypto, cash
  // Liabilities: credit, loan
  const assetTypes = ['checking', 'savings', 'brokerage', 'retirement', 'crypto', 'cash', 'other'];
  const liabilityTypes = ['credit', 'loan'];
  
  const totalAssets = accountBalances
    .filter(a => assetTypes.includes(a.type))
    .reduce((sum, a) => sum + a.balance, 0);
  
  const totalLiabilities = accountBalances
    .filter(a => liabilityTypes.includes(a.type))
    .reduce((sum, a) => sum + Math.abs(a.balance), 0);

  const netWorth = totalAssets - totalLiabilities;

  return NextResponse.json({
    accounts: accountBalances,
    totalsByType,
    totalAssets,
    totalLiabilities,
    netWorth
  });
}
