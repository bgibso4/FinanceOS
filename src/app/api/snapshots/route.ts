import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { convertAmount, parseExchangeRates } from '@/lib/currency';

const createSnapshotSchema = z.object({
  date: z.string().optional(), // ISO date string, defaults to now
  period: z.string().optional(), // e.g., "2024-Q1", "2024-01"
  notes: z.string().optional(),
  isAutomatic: z.boolean().optional(),
  // Manual/backfill mode - when provided, uses these values instead of calculating from transactions
  manual: z
    .object({
      netWorth: z.number(),
      totalAssets: z.number().optional(),
      totalLiabilities: z.number().optional(),
      accountBalances: z
        .record(
          z.string(),
          z.object({
            balance: z.number(),
            name: z.string(),
            type: z.string(),
            currency: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

// Type for manual account balance entry
type ManualAccountBalance = {
  balance: number;
  name: string;
  type: string;
  currency?: string;
};

// Asset types (positive balances contribute to net worth)
const ASSET_TYPES = ['checking', 'savings', 'brokerage', 'retirement', 'crypto', 'cash', 'other'];
// Liability types (balances are subtracted from net worth)
const LIABILITY_TYPES = ['credit', 'loan'];

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

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const limit = parseInt(search.get('limit') ?? '50');
  const startDate = search.get('startDate');
  const endDate = search.get('endDate');

  const where: Record<string, unknown> = {};
  if (startDate || endDate) {
    where.date = {};
    if (startDate) (where.date as Record<string, Date>).gte = new Date(startDate);
    if (endDate) (where.date as Record<string, Date>).lte = new Date(endDate);
  }

  const snapshots = await prisma.netWorthSnapshot.findMany({
    where,
    orderBy: { date: 'desc' },
    take: limit,
  });

  // Parse accountBalances JSON for each snapshot
  const parsed = snapshots.map((s) => ({
    ...s,
    accountBalances: JSON.parse(s.accountBalances),
  }));

  return NextResponse.json({ snapshots: parsed });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createSnapshotSchema.parse(body);

  const snapshotDate = parsed.date ? new Date(parsed.date) : new Date();
  const { baseCurrency } = await getCurrencySettings();

  // Manual/backfill mode - use provided values directly
  if (parsed.manual) {
    const { netWorth, totalAssets, totalLiabilities, accountBalances } = parsed.manual;

    // Build account balances with base currency values
    const formattedBalances: Record<
      string,
      {
        balance: number;
        balanceInBaseCurrency: number;
        name: string;
        type: string;
        currency: string;
      }
    > = {};

    if (accountBalances) {
      for (const [id, acct] of Object.entries(accountBalances) as [
        string,
        ManualAccountBalance,
      ][]) {
        formattedBalances[id] = {
          balance: acct.balance,
          balanceInBaseCurrency: acct.balance, // For manual entry, assume same currency
          name: acct.name,
          type: acct.type,
          currency: acct.currency || baseCurrency,
        };
      }
    }

    // If totals not provided, calculate from net worth (assume no breakdown)
    const finalAssets = totalAssets ?? (netWorth > 0 ? netWorth : 0);
    const finalLiabilities = totalLiabilities ?? (netWorth < 0 ? Math.abs(netWorth) : 0);

    const snapshot = await prisma.netWorthSnapshot.create({
      data: {
        date: snapshotDate,
        netWorth,
        totalAssets: finalAssets,
        totalLiabilities: finalLiabilities,
        accountBalances: JSON.stringify(formattedBalances),
        period: parsed.period ?? null,
        notes: parsed.notes ?? null,
        isAutomatic: false, // Manual entries are never automatic
      },
    });

    return NextResponse.json({
      snapshot: {
        ...snapshot,
        accountBalances: formattedBalances,
      },
      baseCurrency,
    });
  }

  // Standard mode - calculate from transaction data
  const { rateMap } = await getCurrencySettings();

  // Get all active accounts with their transactions
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: {
      transactions: {
        select: { amount: true },
      },
    },
  });

  // Calculate balance for each account
  const accountBalances: Record<
    string,
    { balance: number; balanceInBaseCurrency: number; name: string; type: string; currency: string }
  > = {};

  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const account of accounts) {
    const balance = account.transactions.reduce((sum, tx) => sum + tx.amount, 0);

    // Convert balance to base currency for net worth calculation
    const balanceInBaseCurrency =
      account.currency === baseCurrency
        ? balance
        : convertAmount(balance, account.currency, baseCurrency, rateMap);

    accountBalances[account.id] = {
      balance,
      balanceInBaseCurrency,
      name: account.name,
      type: account.type,
      currency: account.currency,
    };

    if (ASSET_TYPES.includes(account.type)) {
      totalAssets += balanceInBaseCurrency;
    } else if (LIABILITY_TYPES.includes(account.type)) {
      // For liabilities, we store the absolute value
      totalLiabilities += Math.abs(balanceInBaseCurrency);
    }
  }

  const netWorth = totalAssets - totalLiabilities;

  const snapshot = await prisma.netWorthSnapshot.create({
    data: {
      date: snapshotDate,
      netWorth,
      totalAssets,
      totalLiabilities,
      accountBalances: JSON.stringify(accountBalances),
      period: parsed.period ?? null,
      notes: parsed.notes ?? null,
      isAutomatic: parsed.isAutomatic ?? false,
    },
  });

  return NextResponse.json({
    snapshot: {
      ...snapshot,
      accountBalances,
    },
    baseCurrency,
  });
}
