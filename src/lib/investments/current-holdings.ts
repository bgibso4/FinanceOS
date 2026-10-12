import type { PrismaClient, Security } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { PriceBook } from '@/lib/prices/price-book';
import type { HoldingKind, HoldingRow } from './holdings-view';
import { manualHoldingSecurityId } from './manual-holding';
import { roundCents } from './money';

export type CurrentHoldingsOptions = {
  accounts: { id: string; name: string; currency: string; balanceSource: string | null }[];
  today: Date;
  rangeStart: Date;
  baseCurrency: string;
  rates: Map<string, number>;
};

const CASH_LABELS: Record<string, string> = { cash: 'Cash', money_market: 'Money market' };

/** Each account's latest holdings set, priced for today, as page rows. */
export class CurrentHoldingsReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(opts: CurrentHoldingsOptions): Promise<HoldingRow[]> {
    const { accounts, today, rangeStart, baseCurrency, rates } = opts;
    if (!accounts.length) return [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const isLeftoverMirror = (accountId: string, securityId: string) =>
      byId.get(accountId)?.balanceSource === 'valuation' &&
      securityId === manualHoldingSecurityId(accountId);

    const snapshots = (
      await this.prisma.holdingSnapshot.findMany({
        where: { accountId: { in: [...byId.keys()] }, date: { lte: today } },
        include: { security: true },
        orderBy: { date: 'desc' },
      })
    ).filter((s) => !isLeftoverMirror(s.accountId, s.securityId));
    const latestDay = new Map<string, number>();
    for (const s of snapshots) {
      if (!latestDay.has(s.accountId)) latestDay.set(s.accountId, s.date.getTime());
    }
    const current = snapshots.filter((s) => s.date.getTime() === latestDay.get(s.accountId));
    const book = await PriceBook.load(
      this.prisma,
      [...new Set(current.map((s) => s.securityId))],
      today
    );

    return current.map((s) => {
      const account = byId.get(s.accountId)!;
      const kind = kindOf(s.security, account.id);
      const price =
        s.source === 'plaid' ? s.price : (book.at(s.securityId, today)?.price ?? s.price);
      const toAccount = (v: number) =>
        convertAmount(v, s.security.currency, account.currency, rates);
      const toBase = (v: number) => convertAmount(v, account.currency, baseCurrency, rates);
      const value = toAccount(s.quantity * price);
      const startPrice = book.at(s.securityId, rangeStart)?.price;
      const endPrice = book.at(s.securityId, today)?.price;
      const marketPriced =
        kind === 'security' && s.security.pricing !== 'none' && s.security.pricing !== 'fixed';
      return {
        accountId: account.id,
        securityId: s.securityId,
        kind,
        label: labelOf(s.security, kind, account.name),
        name: s.security.name,
        type: s.security.type,
        pricing: s.security.pricing,
        currency: s.security.currency,
        quantity: s.quantity,
        price,
        priceInAccount: toAccount(price),
        value: roundCents(value),
        valueBase: roundCents(toBase(value)),
        gainBase: s.costBasis == null ? null : roundCents(toBase(value - toAccount(s.costBasis))),
        rangeChangePct:
          marketPriced && startPrice && endPrice
            ? ((endPrice - startPrice) / startPrice) * 100
            : null,
      };
    });
  }
}

function kindOf(security: Security, accountId: string): HoldingKind {
  if (security.id === manualHoldingSecurityId(accountId)) return 'account';
  return CASH_LABELS[security.type] ? 'cash' : 'security';
}

function labelOf(security: Security, kind: HoldingKind, accountName: string): string {
  if (kind === 'account') return accountName;
  if (kind === 'cash') return CASH_LABELS[security.type];
  return security.ticker ?? security.name;
}
