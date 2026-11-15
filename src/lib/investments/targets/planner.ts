import type { PrismaClient } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { systemClock, type Clock } from '@/lib/clock';
import { PriceBook } from '@/lib/prices/price-book';
import type { CurrentHoldingsReader } from '../current-holdings';
import { addDays, isoDay, utcDay } from '../dates';
import { roundCents } from '../money';
import { finalTargets, planTrades, targetKey, targetTotals } from './allocation';
import { loadCurrentHoldings } from './load-holdings';
import type { TargetSettingsService } from './settings';

/** A price is stale when it is more than this many days older than today. */
const STALE_AFTER_DAYS = 3;

export type PlanFund = {
  securityId: string;
  ticker: string;
  name: string;
  currency: string;
  price: number | null;
  priceDate: string | null;
  stale: boolean;
};

export type PlanRow = {
  key: string;
  name: string;
  className: string | null;
  fund: PlanFund | null;
  current: number;
  currentPct: number;
  targetPct: number;
  trade: number;
  afterPct: number;
  shares: number | null;
  holdings: {
    accountId: string;
    securityId: string;
    label: string;
    accountName: string;
    value: number;
  }[];
};

export type LeftOutReason = 'account_excluded' | 'typed_balance' | 'cash' | 'not_counted';
export type LeftOutItem = {
  accountId: string;
  /** Null for account-level items (a left-out account, a typed balance). */
  securityId: string | null;
  label: string;
  reason: LeftOutReason;
  value: number;
};

/** One unit of `currency` in the base currency, for the notes under the plan. */
export type PlanRate = { currency: string; rate: number };

export type InvestPlan =
  | {
      ready: true;
      baseCurrency: string;
      amount: number;
      sells: boolean;
      countedTotal: number;
      accountsCounted: number;
      rows: PlanRow[];
      leftOut: LeftOutItem[];
      rates: PlanRate[];
      totals: { countryWeightPct: number; classPct: number };
      pricesAsOf: string | null;
    }
  | { ready: false; reason: 'no_class_targets' | 'no_country_weights' };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fraction = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** Turns an amount and the investing targets into the funds to buy (and sell). */
export class TargetPlanner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: Pick<TargetSettingsService, 'ensureDefaults' | 'setup'>,
    private readonly holdings: Pick<CurrentHoldingsReader, 'read'>,
    private readonly clock: Clock = systemClock
  ) {}

  async plan(input: { amount: number; sells: boolean }): Promise<InvestPlan> {
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      throw new RangeError('Amount must be a number of zero or more');
    }
    const amount = roundCents(input.amount);
    const { sells } = input;

    await this.settings.ensureDefaults();
    const setup = await this.settings.setup();
    const totals = targetTotals(setup);
    const final = finalTargets(setup);
    if (Math.abs(sum(final.map((f) => f.target)) - 1) > 1e-6) {
      return {
        ready: false,
        reason: totals.classPct > 0 ? 'no_country_weights' : 'no_class_targets',
      };
    }

    const today = utcDay(this.clock.now());
    const { accounts, baseCurrency, rates, rows } = await loadCurrentHoldings(
      this.prisma,
      this.holdings,
      today
    );
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const assigned = new Map(
      (
        await this.prisma.security.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.securityId))] } },
          select: { id: true, targetClassId: true, targetRegionId: true },
        })
      ).map((s) => [s.id, s])
    );

    const leftOut: LeftOutItem[] = [];
    const typedBalance = new Set(rows.filter((r) => r.kind === 'account').map((r) => r.accountId));
    const heldBy = new Map(final.map((f) => [f.key, [] as PlanRow['holdings']]));
    const currentOf = new Map(final.map((f) => [f.key, 0]));
    for (const account of accounts.filter((a) => !a.inTargets)) {
      const own = rows.filter((r) => r.accountId === account.id);
      if (own.length) {
        leftOut.push({
          accountId: account.id,
          securityId: null,
          label: account.name,
          reason: 'account_excluded',
          value: roundCents(sum(own.map((r) => r.valueBase))),
        });
      }
    }
    for (const row of rows) {
      const account = accountById.get(row.accountId)!;
      if (!account.inTargets) continue;
      const value = roundCents(row.valueBase);
      const item = { accountId: account.id, securityId: row.securityId, value };
      if (row.kind === 'account') {
        leftOut.push({
          ...item,
          securityId: null,
          label: account.name,
          reason: 'typed_balance',
        });
        continue;
      }
      if (row.kind === 'cash') {
        const name = row.currency === baseCurrency ? row.label : `${row.label} (${row.currency})`;
        leftOut.push({ ...item, label: `${name} · ${account.name}`, reason: 'cash' });
        continue;
      }
      const label = `${row.label} · ${account.name}`;
      const s = assigned.get(row.securityId);
      const key = s?.targetClassId ? targetKey(s.targetClassId, s.targetRegionId) : null;
      if (key === null || !heldBy.has(key)) {
        leftOut.push({ ...item, label, reason: 'not_counted' });
        continue;
      }
      heldBy.get(key)!.push({
        accountId: account.id,
        securityId: row.securityId,
        label: row.label,
        accountName: account.name,
        value,
      });
      currentOf.set(key, currentOf.get(key)! + row.valueBase);
    }

    const current = new Map([...currentOf].map(([k, v]) => [k, roundCents(v)]));
    const countedTotal = roundCents(sum([...current.values()]));
    const trades = planTrades(
      final.map((f) => ({ key: f.key, current: current.get(f.key)!, target: f.target })),
      amount,
      sells
    );
    const funds = await this.loadFunds(
      final.flatMap((f) => (f.buySecurityId ? [f.buySecurityId] : [])),
      today
    );

    const planRows = final.map((f): PlanRow => {
      const trade = trades[f.key];
      const fund = f.buySecurityId ? (funds.get(f.buySecurityId) ?? null) : null;
      const cur = current.get(f.key)!;
      return {
        key: f.key,
        name: f.name,
        className: f.className,
        fund,
        current: cur,
        currentPct: fraction(cur, countedTotal),
        targetPct: f.target,
        trade,
        afterPct: fraction(cur + trade, countedTotal + amount),
        shares:
          fund?.price && trade > 0
            ? Math.round(
                (convertAmount(trade, baseCurrency, fund.currency, rates) / fund.price) * 1000
              ) / 1000
            : null,
        holdings: heldBy.get(f.key)!,
      };
    });

    const dates = planRows.flatMap((r) => (r.fund?.priceDate ? [r.fund.priceDate] : []));
    return {
      ready: true,
      baseCurrency,
      amount,
      sells,
      countedTotal,
      accountsCounted: accounts.filter((a) => a.inTargets && !typedBalance.has(a.id)).length,
      rows: planRows,
      leftOut,
      rates: [
        ...new Set([
          ...rows.map((r) => r.currency),
          ...planRows.flatMap((r) => (r.fund ? [r.fund.currency] : [])),
        ]),
      ]
        .filter((currency) => currency !== baseCurrency)
        .sort()
        .map((currency) => ({ currency, rate: rates.rate(currency, baseCurrency) })),
      totals,
      pricesAsOf: dates.length ? dates.sort()[0] : null,
    };
  }

  /** The "buy with" funds by id, each with its latest stored price. */
  private async loadFunds(ids: string[], today: Date): Promise<Map<string, PlanFund>> {
    const [securities, book] = await Promise.all([
      this.prisma.security.findMany({ where: { id: { in: ids } } }),
      PriceBook.load(this.prisma, ids, today),
    ]);
    const staleBefore = isoDay(addDays(today, -STALE_AFTER_DAYS));
    return new Map(
      securities.map((s) => {
        const latest = book.latest(s.id);
        const priceDate = latest?.date ? isoDay(latest.date) : null;
        return [
          s.id,
          {
            securityId: s.id,
            ticker: s.ticker || s.name,
            name: s.name,
            currency: s.currency,
            price: latest?.price ?? null,
            priceDate,
            stale: priceDate !== null && priceDate < staleBefore,
          },
        ];
      })
    );
  }
}
