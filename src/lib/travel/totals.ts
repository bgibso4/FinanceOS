import type { PrismaClient } from '@prisma/client';
import { findTravelGroup } from '@/lib/categories';
import { loadCurrencySettings, toBase, type CurrencySettings } from '@/lib/currency';
import { dayEnd, dayStart, tripDays } from './dates';
import type { CategorySlice, TripRecord, TripSummary, YearView } from './types';

type Row = {
  date: Date;
  tripId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  amount: number; // base currency
};

/** Every Travel figure: net (signed sum, spend = −sum) and in the base currency. */
export class TravelTotals {
  constructor(private readonly prisma: PrismaClient) {}

  async trip(id: string): Promise<TripSummary | null> {
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (!trip) return null;
    const rows = await this.rows({ tripId: id });
    return summarize(trip, rows);
  }

  async year(year: number): Promise<YearView> {
    const [{ trips, notOnTrip, spent }, previous, first] = await Promise.all([
      this.yearFigures(year),
      this.hasHistoryBefore(year),
      this.prisma.transaction.findFirst({
        where: { isSplitParent: false },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const daysAway = trips.reduce((n, t) => n + t.days, 0);
    const tripSpend = trips.reduce((n, t) => n + t.spend, 0);
    return {
      year,
      trips,
      notOnTrip,
      spent,
      daysAway,
      perDayAverage: daysAway > 0 ? tripSpend / daysAway : 0,
      previousYearSpent: previous ? (await this.yearFigures(year - 1)).spent : null,
      firstYear: first ? first.date.getUTCFullYear() : null,
    };
  }

  /** What counts against the year's Travel budget. */
  async budgetSpent(year: number): Promise<number> {
    return (await this.yearFigures(year)).spent;
  }

  private async yearFigures(year: number) {
    const trips = await this.prisma.trip.findMany({
      where: { startDate: { startsWith: `${year}-` } },
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    const [tripRows, loose] = await Promise.all([
      trips.length > 0 ? this.rows({ tripId: { in: trips.map((t) => t.id) } }) : [],
      this.looseTravelRows(year),
    ]);
    const summaries = trips.map((t) =>
      summarize(
        t,
        tripRows.filter((r) => r.tripId === t.id)
      )
    );
    const notOnTrip = { spend: spendOf(loose), count: loose.length };
    return {
      trips: summaries,
      notOnTrip,
      spent: summaries.reduce((n, t) => n + t.spend, 0) + notOnTrip.spend,
    };
  }

  /** Travel-group rows on no trip, dated in the year. None when there is no Travel group. */
  private async looseTravelRows(year: number): Promise<Row[]> {
    const group = await findTravelGroup(this.prisma);
    if (!group) return [];
    return this.rows({
      tripId: null,
      categoryId: { in: [group.id, ...group.categoryIds] },
      date: { gte: dayStart(`${year}-01-01`), lte: dayEnd(`${year}-12-31`) },
    });
  }

  private async hasHistoryBefore(year: number): Promise<boolean> {
    const earlier = await this.prisma.transaction.findFirst({
      where: { isSplitParent: false, date: { lt: dayStart(`${year}-01-01`) } },
      select: { id: true },
    });
    return earlier !== null;
  }

  private async rows(where: object): Promise<Row[]> {
    const [settings, txs] = await Promise.all([
      loadCurrencySettings(this.prisma),
      this.prisma.transaction.findMany({
        where: { ...where, isSplitParent: false },
        select: {
          date: true,
          amount: true,
          tripId: true,
          categoryId: true,
          category: { select: { name: true } },
          account: { select: { currency: true } },
        },
      }),
    ]);
    return txs.map((t) => toRow(t, settings));
  }
}

function toRow(
  t: {
    date: Date;
    amount: number;
    tripId: string | null;
    categoryId: string | null;
    category: { name: string } | null;
    account: { currency: string };
  },
  settings: CurrencySettings
): Row {
  return {
    date: t.date,
    tripId: t.tripId,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    amount: toBase(t.amount, t.account.currency, settings),
  };
}

const spendOf = (rows: Row[]): number => -rows.reduce((n, r) => n + r.amount, 0) || 0;

function summarize(trip: TripRecord, rows: Row[]): TripSummary {
  const days = tripDays(trip);
  const spend = spendOf(rows);
  const start = dayStart(trip.startDate);
  const moneyIn = rows.filter((r) => r.amount > 0);
  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    days,
    spend,
    perDay: spend / days,
    bookedAhead: spendOf(rows.filter((r) => r.date < start)),
    moneyBack: moneyIn.reduce((n, r) => n + r.amount, 0),
    moneyBackCount: moneyIn.length,
    txCount: rows.length,
    categories: slices(rows),
  };
}

/** Spending rows only, grouped by category, biggest first, as shares of the positive spend. */
function slices(rows: Row[]): CategorySlice[] {
  const byCategory = new Map<string | null, CategorySlice>();
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const slice = byCategory.get(r.categoryId) ?? {
      categoryId: r.categoryId,
      name: r.categoryName ?? 'Uncategorized',
      spend: 0,
      share: 0,
    };
    slice.spend -= r.amount;
    byCategory.set(r.categoryId, slice);
  }
  const all = [...byCategory.values()].sort((a, b) => b.spend - a.spend);
  const total = all.reduce((n, s) => n + s.spend, 0);
  return all.map((s) => ({ ...s, share: s.spend / total }));
}
