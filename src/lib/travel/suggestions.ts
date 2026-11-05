import type { Prisma, PrismaClient } from '@prisma/client';
import { findTravelGroup, isIncomeCategory } from '@/lib/categories';
import { TX_ROW_INCLUDE, toTxRow } from '@/lib/transaction-rows';
import { addDays, dayEnd, dayStart } from './dates';
import type { Suggestion, SuggestionGroup, TripRecord } from './types';

type Candidate = Prisma.TransactionGetPayload<{ include: typeof TX_ROW_INCLUDE }>;

export type RuleContext = {
  travelCategoryIds: Set<string>;
  flightsAndLodgingIds: Set<string>;
  recurringKeys: Set<string>;
};

export interface SuggestionRule {
  group: SuggestionGroup;
  preTicked: boolean;
  window(trip: TripRecord): { from: string; to: string };
  matches(c: Candidate, ctx: RuleContext): boolean;
  reason(c: Candidate, trip: TripRecord): string;
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY_MS);

const inTravel = (c: Candidate, ctx: RuleContext) =>
  c.categoryId !== null && ctx.travelCategoryIds.has(c.categoryId);
const isRecurring = (c: Candidate, ctx: RuleContext) =>
  ctx.recurringKeys.has(recurringKey(c.accountId, c.merchantNormalized));
const recurringKey = (accountId: string, merchant: string) => `${accountId}|${merchant}`;

const duringTrip = () => 'During the trip';
const tripWindow = (t: TripRecord) => ({ from: t.startDate, to: t.endDate });

export class BookedBeforeRule implements SuggestionRule {
  group = 'before' as const;
  preTicked = true;
  window = (t: TripRecord) => ({ from: addDays(t.startDate, -120), to: addDays(t.startDate, -1) });
  matches = (c: Candidate, ctx: RuleContext) =>
    c.categoryId !== null && ctx.flightsAndLodgingIds.has(c.categoryId);
  reason = (c: Candidate, t: TripRecord) =>
    `${daysBetween(isoDay(c.date), t.startDate)} days before`;
}

export class DuringRule implements SuggestionRule {
  group = 'during' as const;
  preTicked = true;
  window = tripWindow;
  matches = inTravel;
  reason = duringTrip;
}

export class OtherDuringRule implements SuggestionRule {
  group = 'other' as const;
  preTicked = false;
  window = tripWindow;
  matches = (c: Candidate, ctx: RuleContext) =>
    Number(c.amount) < 0 &&
    !inTravel(c, ctx) &&
    !isIncomeCategory(c.category) &&
    !isRecurring(c, ctx);
  reason = duringTrip;
}

export class AfterRule implements SuggestionRule {
  group = 'after' as const;
  preTicked = false;
  window = (t: TripRecord) => ({ from: addDays(t.endDate, 1), to: addDays(t.endDate, 21) });
  matches = (c: Candidate, ctx: RuleContext) =>
    inTravel(c, ctx) ||
    (Number(c.amount) > 0 && !isIncomeCategory(c.category) && !isRecurring(c, ctx));
  reason = (c: Candidate, t: TripRecord) => `${daysBetween(t.endDate, isoDay(c.date))} days after`;
}

export const defaultRules = (): SuggestionRule[] => [
  new BookedBeforeRule(),
  new DuringRule(),
  new OtherDuringRule(),
  new AfterRule(),
];

/** Proposes unlinked transactions for a trip. The user reviews; nothing is linked here. */
export class TripSuggester {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rules: SuggestionRule[] = defaultRules()
  ) {}

  async suggest(tripId: string): Promise<Suggestion[]> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return [];

    const windows = this.rules.map((r) => r.window(trip));
    const from = windows.map((w) => w.from).reduce((a, b) => (a < b ? a : b));
    const to = windows.map((w) => w.to).reduce((a, b) => (a > b ? a : b));

    const [candidates, ctx] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          tripId: null,
          isTransfer: false,
          isSplitParent: false,
          tripDismissals: { none: { tripId } },
          date: { gte: dayStart(from), lte: dayEnd(to) },
        },
        include: TX_ROW_INCLUDE,
      }),
      this.context(),
    ]);

    const out: { s: Suggestion; order: number }[] = [];
    for (const c of candidates) {
      const order = this.rules.findIndex((r, i) => {
        const w = windows[i];
        return c.date >= dayStart(w.from) && c.date <= dayEnd(w.to) && r.matches(c, ctx);
      });
      if (order < 0) continue;
      const rule = this.rules[order];
      out.push({
        order,
        s: {
          tx: toTxRow(c),
          group: rule.group,
          preTicked: rule.preTicked,
          reason: rule.reason(c, trip),
        },
      });
    }
    return out
      .sort((a, b) => a.order - b.order || a.s.tx.date.getTime() - b.s.tx.date.getTime())
      .map((o) => o.s);
  }

  async count(tripId: string): Promise<number> {
    return (await this.suggest(tripId)).length;
  }

  private async context(): Promise<RuleContext> {
    const [group, recurring] = await Promise.all([
      findTravelGroup(this.prisma),
      this.prisma.recurringTransaction.findMany({
        where: { status: 'active' },
        select: { accountId: true, merchantPattern: true },
      }),
    ]);
    return {
      travelCategoryIds: new Set(group ? [group.id, ...group.categoryIds] : []),
      flightsAndLodgingIds: new Set(group?.flightsAndLodgingIds ?? []),
      recurringKeys: new Set(recurring.map((r) => recurringKey(r.accountId, r.merchantPattern))),
    };
  }
}
