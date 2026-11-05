import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData } from '../../helpers/factories';
import { TravelTotals } from '@/lib/travel/totals';
import { fixedClock } from '@/lib/clock';

describe('TravelTotals', () => {
  let prisma: PrismaClient;
  let totals: TravelTotals;
  let accountId: string;
  let cadAccountId: string;
  let travelId: string;
  let flightsId: string;
  let foodId: string;
  let tripSeq = 0;

  beforeAll(async () => {
    prisma = await setupTestDb();
    totals = new TravelTotals(prisma);
  });
  afterAll(teardownTestDb);

  beforeEach(async () => {
    await resetTestDb();
    await prisma.userSettings.create({ data: { baseCurrency: 'USD' } });
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 },
    });
    accountId = (await prisma.account.create({ data: createAccountData() })).id;
    cadAccountId = (await prisma.account.create({ data: createAccountData({ currency: 'CAD' }) }))
      .id;
    travelId = (await prisma.category.create({ data: createCategoryData({ name: 'Travel' }) })).id;
    flightsId = (
      await prisma.category.create({
        data: createCategoryData({ name: 'Flights', parentId: travelId }),
      })
    ).id;
    foodId = (
      await prisma.category.create({
        data: createCategoryData({ name: 'Food', parentId: travelId }),
      })
    ).id;
  });

  const trip = (startDate: string, endDate: string) =>
    prisma.trip.create({ data: { name: `Trip ${++tripSeq}`, startDate, endDate } });

  const tx = (
    date: string,
    amount: number,
    o: {
      tripId?: string | null;
      categoryId?: string | null;
      accountId?: string;
      isSplitParent?: boolean;
    } = {}
  ) =>
    prisma.transaction.create({
      data: {
        date: new Date(`${date}T12:00:00.000Z`),
        amount,
        merchant: 'M',
        accountId: o.accountId ?? accountId,
        tripId: o.tripId ?? null,
        categoryId: o.categoryId === undefined ? foodId : o.categoryId,
        isSplitParent: o.isSplitParent ?? false,
      },
    });

  it('sumsNetSpendPerTrip', async () => {
    const t = await trip('2026-01-13', '2026-01-21');
    await tx('2026-01-14', -100, { tripId: t.id });
    await tx('2026-01-15', -50, { tripId: t.id });
    await tx('2026-01-16', 30, { tripId: t.id });
    expect((await totals.trip(t.id))?.spend).toBe(120);
  });

  it('returns null for an unknown trip', async () => {
    expect(await totals.trip('nope')).toBeNull();
  });

  it('convertsForeignAmountsToBase', async () => {
    const t = await trip('2026-01-13', '2026-01-21');
    await tx('2026-01-14', -100, { tripId: t.id, accountId: cadAccountId });
    expect((await totals.trip(t.id))?.spend).toBe(75);
  });

  it('perDayAndDays', async () => {
    const t = await trip('2026-01-13', '2026-01-21');
    await tx('2026-01-14', -90, { tripId: t.id });
    const s = await totals.trip(t.id);
    expect(s?.days).toBe(9);
    expect(s?.perDay).toBe(10);
  });

  it('oneDayTripCountsOneDay', async () => {
    const t = await trip('2026-03-05', '2026-03-05');
    await tx('2026-03-05', -40, { tripId: t.id });
    const s = await totals.trip(t.id);
    expect(s?.days).toBe(1);
    expect(s?.perDay).toBe(40);
  });

  it('emptyTripHasZeroPerDay', async () => {
    const t = await trip('2026-03-05', '2026-03-08');
    const s = await totals.trip(t.id);
    expect(s).toMatchObject({ spend: 0, perDay: 0, txCount: 0, categories: [] });
  });

  it('bookedAheadIsSpendBeforeStart', async () => {
    const t = await trip('2026-03-05', '2026-03-08');
    await tx('2026-02-01', -300, { tripId: t.id, categoryId: flightsId });
    await tx('2026-03-05', -20, { tripId: t.id });
    const s = await totals.trip(t.id);
    expect(s?.bookedAhead).toBe(300);
    expect(s?.spend).toBe(320);
  });

  it('moneyBackSumsIncoming', async () => {
    const t = await trip('2026-03-05', '2026-03-08');
    await tx('2026-03-05', -100, { tripId: t.id });
    await tx('2026-03-06', 40, { tripId: t.id });
    await tx('2026-03-07', 20, { tripId: t.id, accountId: cadAccountId });
    const s = await totals.trip(t.id);
    expect(s?.moneyBack).toBe(55);
    expect(s?.moneyBackCount).toBe(2);
    expect(s?.txCount).toBe(3);
  });

  it('categoriesSortedWithShares', async () => {
    const t = await trip('2026-03-05', '2026-03-08');
    await tx('2026-03-05', -25, { tripId: t.id });
    await tx('2026-03-05', -75, { tripId: t.id, categoryId: flightsId });
    await tx('2026-03-06', 500, { tripId: t.id, categoryId: flightsId });
    await tx('2026-03-06', -0.01, { tripId: t.id, categoryId: null });
    const { categories } = (await totals.trip(t.id))!;
    expect(categories.map((c) => c.name)).toEqual(['Flights', 'Food', 'Uncategorized']);
    expect(categories[0]).toMatchObject({ categoryId: flightsId, spend: 75 });
    expect(categories[0].share).toBeCloseTo(0.75, 2);
    expect(categories[1].share).toBeCloseTo(0.25, 2);
  });

  it('countsWholeTripInItsStartYear', async () => {
    const t = await trip('2026-12-28', '2027-01-03');
    await tx('2026-11-15', -500, { tripId: t.id, categoryId: flightsId });
    await tx('2026-12-30', -100, { tripId: t.id });
    await tx('2027-01-02', -50, { tripId: t.id });
    const y26 = await totals.year(2026);
    const y27 = await totals.year(2027);
    expect(y26.spent).toBe(650);
    expect(y26.trips.map((x) => x.id)).toEqual([t.id]);
    expect(y26.daysAway).toBe(7);
    expect(y26.perDayAverage).toBeCloseTo(650 / 7, 5);
    expect(y27.spent).toBe(0);
    expect(y27.trips).toEqual([]);
    expect(await totals.budgetSpent(2026)).toBe(650);
  });

  it('bookingBeforeTripExistsCountsByDateThenMoves', async () => {
    await tx('2026-12-10', -200, { categoryId: flightsId });
    expect((await totals.year(2026)).notOnTrip).toEqual({ spend: 200, count: 1 });
    expect((await totals.year(2026)).spent).toBe(200);

    const t = await trip('2027-02-01', '2027-02-05');
    await prisma.transaction.updateMany({ data: { tripId: t.id } });
    const y26 = await totals.year(2026);
    const y27 = await totals.year(2027);
    expect(y26.spent).toBe(0);
    expect(y26.notOnTrip).toEqual({ spend: 0, count: 0 });
    expect(y27.spent).toBe(200);
  });

  it('notOnTripOnlyTravelGroup', async () => {
    const other = await prisma.category.create({ data: createCategoryData({ name: 'Groceries' }) });
    await tx('2026-05-01', -60, { categoryId: other.id });
    await tx('2026-05-02', -10, { categoryId: null });
    await tx('2026-05-03', -30, { categoryId: foodId });
    expect((await totals.year(2026)).notOnTrip).toEqual({ spend: 30, count: 1 });
  });

  it('has no notOnTrip without a Travel group', async () => {
    await resetTestDb();
    const acc = await prisma.account.create({ data: createAccountData() });
    await tx('2026-05-03', -30, { categoryId: null, accountId: acc.id });
    expect((await totals.year(2026)).notOnTrip).toEqual({ spend: 0, count: 0 });
  });

  it('previousYearNullWithoutHistory', async () => {
    await tx('2026-05-03', -30);
    const y = await totals.year(2026);
    expect(y.previousYearSpent).toBeNull();
    expect(y.firstDate).toBe('2026-05-03');
  });

  it('previous year spent when history exists', async () => {
    await tx('2025-01-01', -80);
    await tx('2026-05-03', -30);
    const y = await totals.year(2026);
    expect(y.previousYearSpent).toBe(80);
    expect(y.firstDate).toBe('2025-01-01');
  });

  it('no previous year figure when history starts mid previous year', async () => {
    await tx('2025-11-03', -80);
    await tx('2026-05-03', -30);
    const y = await totals.year(2026);
    expect(y.previousYearSpent).toBeNull();
    expect(y.firstDate).toBe('2025-11-03');
  });

  it('firstDate is null with no transactions', async () => {
    const y = await totals.year(2026);
    expect(y.firstDate).toBeNull();
    expect(y.previousYearSpent).toBeNull();
  });

  it('splitParentsIgnored', async () => {
    const t = await trip('2026-03-05', '2026-03-08');
    await tx('2026-03-05', -100, { tripId: t.id, isSplitParent: true });
    await tx('2026-03-05', -60, { tripId: t.id });
    await tx('2026-05-03', -999, { isSplitParent: true });
    expect((await totals.trip(t.id))?.spend).toBe(60);
    expect((await totals.year(2026)).notOnTrip).toEqual({ spend: 0, count: 0 });
  });

  it('notOnTripTransactionsSumToNotOnTripSpend', async () => {
    const t = await trip('2026-03-05', '2026-03-08');
    await tx('2026-03-06', -60, { tripId: t.id });
    await tx('2026-04-01', -200, { categoryId: flightsId });
    await tx('2026-05-02', -30, { categoryId: travelId });
    await tx('2026-06-02', 10, { categoryId: flightsId });
    await tx('2026-06-03', -999, { categoryId: null });
    await tx('2025-12-31', -77, { categoryId: flightsId });
    await tx('2026-07-01', -500, { categoryId: flightsId, isSplitParent: true });
    const rows = await totals.notOnTripTransactions(2026);
    const { notOnTrip } = await totals.year(2026);
    expect(rows).toHaveLength(notOnTrip.count);
    expect(-rows.reduce((n, r) => n + r.amount, 0)).toBe(notOnTrip.spend);
    expect(rows.map((r) => r.amount)).toEqual([10, -30, -200]);
    expect(rows[0].category?.name).toBe('Flights');
  });

  it('notOnTripTransactionsEmptyWithoutTravelGroup', async () => {
    await prisma.category.deleteMany({ where: { parentId: travelId } });
    await prisma.transaction.deleteMany();
    await prisma.category.delete({ where: { id: travelId } });
    await tx('2026-04-01', -200, { categoryId: null });
    expect(await totals.notOnTripTransactions(2026)).toEqual([]);
  });

  it('lastYearIsTheLaterOfTodayAndTheLatestTrip', async () => {
    const clock = fixedClock('2026-11-05T00:00:00.000Z');
    const withClock = new TravelTotals(prisma, clock);
    expect((await withClock.year(2026)).lastYear).toBe(2026);
    await trip('2027-02-01', '2027-02-05');
    await trip('2026-02-01', '2026-02-05');
    expect((await withClock.year(2026)).lastYear).toBe(2027);
  });
});
