import type { Account, PrismaClient } from '@prisma/client';
import { RateBook } from '@/lib/fx/rate-book';
import type { CurrentHoldingsReader } from '../current-holdings';
import type { HoldingRow } from '../holdings-view';

/** Active investment accounts and their current holdings, valued in the base currency. */
export async function loadCurrentHoldings(
  prisma: PrismaClient,
  holdings: Pick<CurrentHoldingsReader, 'read'>,
  today: Date
): Promise<{ accounts: Account[]; baseCurrency: string; rates: RateBook; rows: HoldingRow[] }> {
  const [accounts, settings, rates] = await Promise.all([
    prisma.account.findMany({
      where: { trackingMode: 'investment', isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.userSettings.findFirst(),
    RateBook.load(prisma),
  ]);
  const baseCurrency = settings?.baseCurrency || 'USD';
  const rows = await holdings.read({ accounts, today, rangeStart: today, baseCurrency, rates });
  return { accounts, baseCurrency, rates, rows };
}
