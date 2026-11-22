import type { Account, PrismaClient } from '@prisma/client';
import { getAccountBalances } from '@/lib/balances';
import { convertAmount } from '@/lib/currency';
import { RateBook } from '@/lib/fx/rate-book';
import type { CurrentHoldingsReader } from '../current-holdings';
import { manualHoldingSecurityId } from '../entered-balances';
import type { HoldingRow } from '../holdings-view';
import { Pricing, SecurityType } from '../codes';
import { roundCents } from '../money';

/**
 * Active investment accounts and their current holdings, valued in the base currency.
 * An account with a balance but no reported holdings gets one balance-only row, so its
 * money still shows up (it can't be counted toward a target without funds).
 */
export async function loadCurrentHoldings(
  prisma: PrismaClient,
  holdings: Pick<CurrentHoldingsReader, 'read'>,
  today: Date
): Promise<{ accounts: Account[]; baseCurrency: string; rates: RateBook; rows: HoldingRow[] }> {
  const [accounts, settings, rates] = await Promise.all([
    prisma.account.findMany({
      where: { trackingMode: 'investment', isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.userSettings.findFirst(),
    RateBook.load(prisma),
  ]);
  const baseCurrency = settings?.baseCurrency || 'USD';
  const [held, balances] = await Promise.all([
    holdings.read({ accounts, today, rangeStart: today, baseCurrency, rates }),
    getAccountBalances(prisma, accounts),
  ]);
  const withHoldings = new Set(held.map((r) => r.accountId));
  const balanceOnly = accounts.flatMap((a): HoldingRow[] => {
    const balance = balances.get(a.id)?.balance ?? 0;
    if (withHoldings.has(a.id) || balance === 0) return [];
    return [
      {
        accountId: a.id,
        securityId: manualHoldingSecurityId(a.id),
        kind: 'account',
        label: a.name,
        name: a.name,
        type: SecurityType.Other,
        pricing: Pricing.None,
        currency: a.currency,
        quantity: 1,
        price: balance,
        priceInAccount: balance,
        value: roundCents(balance),
        valueBase: roundCents(convertAmount(balance, a.currency, baseCurrency, rates)),
        gainBase: null,
        rangeChangePct: null,
      },
    ];
  });
  return { accounts, baseCurrency, rates, rows: [...held, ...balanceOnly] };
}
