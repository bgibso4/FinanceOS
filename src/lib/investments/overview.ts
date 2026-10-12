import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { getAccountBalances } from '@/lib/balances';
import { convertAmount } from '@/lib/currency';
import { loadFxRates } from '@/lib/prices/price-book';
import type { PriceFreshness, PriceRefresher } from '@/lib/prices/refresh';
import { ACTIVITY_ROWS_PER_ACCOUNT, buildActivity, type ActivityItem } from './activity';
import type { CurrentHoldingsReader } from './current-holdings';
import { isoDay, utcDay } from './dates';
import { convertSeries, sumSeries, type SeriesPoint, type ValueHistoryService } from './history';
import type { HoldingRow } from './holdings-view';
import { roundCents } from './money';
import {
  accountGroup,
  rangeStart,
  seriesChange,
  wrapperLabel,
  type AccountGroup,
  type Range,
  type SeriesChange,
} from './portfolio-view';

export type BalanceSource = 'provider' | 'valuation' | 'manual';
export type PriceFreshnessView = { asOf: string | null; stale: boolean };

export type AccountStatus = {
  needsReauth: { since: string } | null;
  waiting: { showingFrom: string | null } | null;
  unpriced: { securityId: string; label: string }[];
  tradesReported: boolean;
};

export type AccountSummary = {
  id: string;
  name: string;
  institution: string;
  group: AccountGroup;
  wrapper: string;
  currency: string;
  balanceSource: BalanceSource;
  value: number;
  valueBase: number;
  asOf: string | null;
  lastSyncAt: string | null;
  enrollmentId: string | null;
  series: SeriesPoint[];
  change: SeriesChange | null;
  prices: PriceFreshnessView | null;
  status: AccountStatus;
};

export type InvestmentOverview = {
  range: Range;
  today: string;
  baseCurrency: string;
  prices: PriceFreshnessView;
  portfolio: { value: number; series: SeriesPoint[]; change: SeriesChange | null };
  accounts: AccountSummary[];
  holdings: HoldingRow[];
  activity: ActivityItem[];
};

/** Plaid steps whose pending state means the account is waiting on its institution. */
const WAITING_STEPS = new Set(['holdings', 'transactions']);

const freshnessView = (f: PriceFreshness): PriceFreshnessView => ({
  asOf: f.asOf ? isoDay(f.asOf) : null,
  stale: f.stale,
});

/** Everything the investments page shows for one range, in one payload. */
export class InvestmentOverviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly history: Pick<ValueHistoryService, 'accountSeries'>,
    private readonly holdings: Pick<CurrentHoldingsReader, 'read'>,
    private readonly prices: Pick<PriceRefresher, 'freshness'>,
    private readonly clock: Clock = systemClock
  ) {}

  async load(range: Range): Promise<InvestmentOverview> {
    const prisma = this.prisma;
    const today = utcDay(this.clock.now());
    const from = rangeStart(range, today);
    const [accounts, settings, rates] = await Promise.all([
      prisma.account.findMany({
        where: { trackingMode: 'investment', isActive: true },
        include: {
          plaidConnection: {
            include: { plaidEnrollment: { select: { id: true, institutionName: true } } },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.userSettings.findFirst(),
      loadFxRates(prisma),
    ]);
    const baseCurrency = settings?.baseCurrency || 'USD';
    const ids = accounts.map((a) => a.id);

    const [balances, holdings, trades, plaidDays, recent, prices] = await Promise.all([
      getAccountBalances(prisma, accounts),
      this.holdings.read({ accounts, today, rangeStart: from, baseCurrency, rates }),
      prisma.investmentTransaction.groupBy({
        by: ['accountId'],
        _count: { _all: true },
        where: { accountId: { in: ids } },
      }),
      prisma.holdingSnapshot.groupBy({
        by: ['accountId'],
        _max: { date: true },
        where: { accountId: { in: ids }, source: 'plaid' },
      }),
      // Newest rows per account, so a busy account can't crowd out a quieter one's feed.
      Promise.all(
        ids.map((accountId) =>
          prisma.investmentTransaction.findMany({
            where: { accountId, isCancelled: false, type: { not: 'cancel' } },
            include: { security: { select: { ticker: true, name: true } } },
            orderBy: { date: 'desc' },
            take: ACTIVITY_ROWS_PER_ACCOUNT,
          })
        )
      ),
      this.prices.freshness(),
    ]);
    const tradeCount = new Map(trades.map((t) => [t.accountId, t._count._all]));
    const lastPlaidDay = new Map(plaidDays.map((d) => [d.accountId, d._max.date]));

    const summaries: AccountSummary[] = [];
    for (const a of accounts) {
      const native = await this.history.accountSeries(a.id, from, today, { rates });
      const series = convertSeries(native, a.currency, baseCurrency, rates);
      const balance = balances.get(a.id)!;
      const rows = holdings.filter((h) => h.accountId === a.id);
      const source = (a.balanceSource ?? 'manual') as BalanceSource;
      const conn = a.plaidConnection;
      const pending = conn?.pendingSteps?.split(',') ?? [];
      const showingFrom = lastPlaidDay.get(a.id);
      summaries.push({
        id: a.id,
        name: a.name,
        institution: a.institution ?? conn?.plaidEnrollment.institutionName ?? '',
        group: accountGroup(a.type),
        wrapper: wrapperLabel(conn?.plaidAccountSubtype ?? null, a.type),
        currency: a.currency,
        balanceSource: source,
        value: balance.balance,
        valueBase: roundCents(convertAmount(balance.balance, a.currency, baseCurrency, rates)),
        asOf: balance.asOf ? isoDay(balance.asOf) : null,
        lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
        enrollmentId: conn?.plaidEnrollment.id ?? null,
        series,
        change: source === 'manual' ? null : seriesChange(series),
        prices:
          source === 'valuation'
            ? freshnessView(
                await this.prices.freshness({ securityIds: rows.map((r) => r.securityId) })
              )
            : null,
        status: {
          needsReauth: conn?.status === 'needs_reauth' ? { since: isoDay(conn.updatedAt) } : null,
          waiting: pending.some((s) => WAITING_STEPS.has(s))
            ? { showingFrom: showingFrom ? isoDay(showingFrom) : null }
            : null,
          unpriced: rows
            .filter((r) => r.pricing === 'none')
            .map((r) => ({ securityId: r.securityId, label: r.label })),
          tradesReported: source !== 'provider' || (tradeCount.get(a.id) ?? 0) > 0,
        },
      });
    }

    const portfolioSeries = sumSeries(summaries.map((s) => s.series));
    return {
      range,
      today: isoDay(today),
      baseCurrency,
      prices: freshnessView(prices),
      portfolio: {
        value: roundCents(summaries.reduce((sum, s) => sum + s.valueBase, 0)),
        series: portfolioSeries,
        change: seriesChange(portfolioSeries),
      },
      accounts: summaries,
      holdings,
      activity: buildActivity(
        recent.flat().map((t) => ({
          id: t.id,
          accountId: t.accountId,
          date: t.date,
          type: t.type,
          subtype: t.subtype,
          name: t.name,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          currency: t.currency,
          securityId: t.securityId,
          ticker: t.security?.ticker ?? null,
          securityName: t.security?.name ?? null,
        }))
      ),
    };
  }
}
