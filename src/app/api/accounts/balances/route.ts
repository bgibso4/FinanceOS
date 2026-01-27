import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { convertAmount, parseExchangeRates } from '@/lib/currency';

// Helper to get exchange rates and base currency from database
async function getCurrencySettings() {
  const [rates, settings] = await Promise.all([
    prisma.exchangeRate.findMany(),
    prisma.userSettings.findFirst(),
  ]);

  const rateMap = parseExchangeRates(rates);
  const baseCurrency = settings?.baseCurrency || 'USD';

  return { rateMap, baseCurrency };
}

export async function GET() {
  // Get currency settings for conversion
  const { rateMap, baseCurrency } = await getCurrencySettings();

  // Get all active accounts with their transactions
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: {
      transactions: {
        select: { amount: true, isTransfer: true },
      },
    },
  });

  // Calculate balance for each account (with currency conversion)
  const accountBalances = accounts.map((account) => {
    const balance = account.transactions.reduce((sum, tx) => sum + tx.amount, 0);

    // Convert to base currency for display
    const balanceInBaseCurrency =
      account.currency === baseCurrency
        ? balance
        : convertAmount(balance, account.currency, baseCurrency, rateMap);

    return {
      id: account.id,
      name: account.name,
      type: account.type,
      institution: account.institution,
      currency: account.currency,
      balance: balanceInBaseCurrency, // Display in base currency
      nativeBalance: balance, // Original currency balance
    };
  });

  // Calculate totals by type (using converted balances)
  const totalsByType: Record<string, number> = {};
  accountBalances.forEach((acc) => {
    totalsByType[acc.type] = (totalsByType[acc.type] ?? 0) + acc.balance;
  });

  // Net worth = assets - liabilities
  // Assets: checking, savings, brokerage, retirement, crypto, cash
  // Liabilities: credit, loan
  const assetTypes = ['checking', 'savings', 'brokerage', 'retirement', 'crypto', 'cash', 'other'];
  const liabilityTypes = ['credit', 'loan'];

  const totalAssets = accountBalances
    .filter((a) => assetTypes.includes(a.type))
    .reduce((sum, a) => sum + a.balance, 0);

  const totalLiabilities = accountBalances
    .filter((a) => liabilityTypes.includes(a.type))
    .reduce((sum, a) => sum + Math.abs(a.balance), 0);

  const netWorth = totalAssets - totalLiabilities;

  return NextResponse.json({
    accounts: accountBalances,
    totalsByType,
    totalAssets,
    totalLiabilities,
    netWorth,
    baseCurrency,
  });
}
