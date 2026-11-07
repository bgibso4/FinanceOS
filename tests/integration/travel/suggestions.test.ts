import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData } from '../../helpers/factories';
import { TripSuggester } from '@/lib/travel/suggestions';

describe('TripSuggester', () => {
  let prisma: PrismaClient;
  let suggester: TripSuggester;
  let accountId: string;
  let tripId: string;
  let travelId: string;
  let flightsId: string;
  let foodId: string;
  let salaryId: string;
  let shopId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    suggester = new TripSuggester(prisma);
  });
  afterAll(teardownTestDb);

  const cat = async (name: string, o: { type?: string; parentId?: string } = {}) =>
    (await prisma.category.create({ data: createCategoryData({ name, ...o }) })).id;

  beforeEach(async () => {
    await resetTestDb();
    accountId = (await prisma.account.create({ data: createAccountData() })).id;
    travelId = await cat('Travel');
    flightsId = await cat('Flights', { parentId: travelId });
    await cat('Lodging', { parentId: travelId });
    foodId = await cat('Food', { parentId: travelId });
    const incomeId = await cat('Income', { type: 'income' });
    salaryId = await cat('Salary', { type: 'income', parentId: incomeId });
    shopId = await cat('Shopping');
    tripId = (
      await prisma.trip.create({
        data: { name: 'Japan', startDate: '2026-01-13', endDate: '2026-01-21' },
      })
    ).id;
  });

  const tx = (
    date: string,
    amount: number,
    categoryId: string | null,
    o: Partial<{
      merchant: string;
      tripId: string;
      isTransfer: boolean;
      isSplitParent: boolean;
    }> = {}
  ) =>
    prisma.transaction.create({
      data: {
        date: new Date(`${date}T12:00:00.000Z`),
        amount,
        merchant: o.merchant ?? 'M',
        merchantNormalized: (o.merchant ?? 'M').toLowerCase(),
        accountId,
        categoryId,
        tripId: o.tripId ?? null,
        isTransfer: o.isTransfer ?? false,
        isSplitParent: o.isSplitParent ?? false,
      },
    });

  const only = async () => {
    const s = await suggester.suggest(tripId);
    expect(s).toHaveLength(1);
    return s[0];
  };

  it('flightBookedFortySixDaysBeforeIsSuggestedTicked', async () => {
    await tx('2025-11-28', -900, flightsId);
    const s = await only();
    expect(s).toMatchObject({ group: 'before', preTicked: true, reason: '46 days before' });
  });

  it('flightOverFourMonthsBeforeIsNot', async () => {
    await tx('2025-09-01', -900, flightsId);
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('foodDuringIsTicked', async () => {
    await tx('2026-01-15', -40, foodId);
    expect(await only()).toMatchObject({
      group: 'during',
      preTicked: true,
      reason: 'During the trip',
    });
  });

  it('pharmacyDuringIsOtherUnticked', async () => {
    await tx('2026-01-15', -12, shopId);
    expect(await only()).toMatchObject({
      group: 'other',
      preTicked: false,
      reason: 'During the trip',
    });
  });

  it('salaryDuringIsHidden', async () => {
    await tx('2026-01-15', 3000, salaryId);
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('recurringSubscriptionDuringIsHidden', async () => {
    await prisma.recurringTransaction.create({
      data: {
        merchantPattern: 'netflix',
        merchantDisplay: 'Netflix',
        accountId,
        frequency: 'monthly',
        expectedAmount: 15,
        medianIntervalDays: 30,
        confidence: 0.9,
        intervalRegularity: 0.9,
        amountConsistency: 0.9,
        transactionCount: 6,
        firstSeenDate: new Date('2025-01-01'),
        lastSeenDate: new Date('2026-01-01'),
        status: 'active',
      },
    });
    await tx('2026-01-15', -15, shopId, { merchant: 'Netflix' });
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('paybackFiveDaysAfterIsUnticked', async () => {
    await tx('2026-01-26', 50, shopId);
    expect(await only()).toMatchObject({
      group: 'after',
      preTicked: false,
      reason: '5 days after',
    });
  });

  it('travelMoneyBackAfterIsTicked', async () => {
    await tx('2026-01-26', 50, foodId);
    expect(await only()).toMatchObject({ group: 'after', preTicked: true });
  });

  it('afterGroupListsTravelRowsBeforeOtherMoneyIn', async () => {
    await tx('2026-01-23', 50, shopId, { merchant: 'Payback' });
    await tx('2026-01-30', -20, foodId, { merchant: 'Late charge' });
    const s = await suggester.suggest(tripId);
    expect(s.map((x) => [x.tx.merchant, x.group, x.preTicked])).toEqual([
      ['Late charge', 'after', true],
      ['Payback', 'after', false],
    ]);
  });

  it('recurringMoneyInAfterIsHidden', async () => {
    await prisma.recurringTransaction.create({
      data: {
        merchantPattern: 'dividend',
        merchantDisplay: 'Dividend',
        accountId,
        frequency: 'monthly',
        expectedAmount: 15,
        medianIntervalDays: 30,
        confidence: 0.9,
        intervalRegularity: 0.9,
        amountConsistency: 0.9,
        transactionCount: 6,
        firstSeenDate: new Date('2025-01-01'),
        lastSeenDate: new Date('2026-01-01'),
        status: 'active',
      },
    });
    await tx('2026-01-26', 15, shopId, { merchant: 'Dividend' });
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('travelSettleUpAfterIsTicked', async () => {
    await tx('2026-01-31', -165, foodId);
    expect(await only()).toMatchObject({
      group: 'after',
      preTicked: true,
      reason: '10 days after',
    });
  });

  it('salaryAfterIsHidden', async () => {
    await tx('2026-01-26', 3000, salaryId);
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('excludesTransactionsOnAnyTrip', async () => {
    const other = await prisma.trip.create({
      data: { name: 'Other', startDate: '2026-03-01', endDate: '2026-03-02' },
    });
    await tx('2026-01-15', -40, foodId, { tripId: other.id });
    await tx('2026-01-16', -40, foodId, { tripId });
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('excludesDismissed', async () => {
    const t = await tx('2026-01-15', -40, foodId);
    await prisma.tripDismissal.create({ data: { tripId, transactionId: t.id } });
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('excludesTransfersAndSplitParents', async () => {
    await tx('2026-01-15', -40, foodId, { isTransfer: true });
    await tx('2026-01-16', -40, foodId, { isSplitParent: true });
    expect(await suggester.suggest(tripId)).toEqual([]);
  });

  it('noTravelGroupSuggestsOnlyOtherAndMoneyIn', async () => {
    await prisma.category.deleteMany({ where: { parentId: travelId } });
    await prisma.category.delete({ where: { id: travelId } });
    await tx('2025-11-28', -900, null);
    await tx('2026-01-15', -40, null);
    await tx('2026-01-26', 50, null);
    const s = await suggester.suggest(tripId);
    expect(s.map((x) => x.group)).toEqual(['other', 'after']);
  });

  it('ordersByGroupThenDate', async () => {
    await tx('2026-01-26', 50, shopId);
    await tx('2026-01-16', -10, shopId);
    await tx('2026-01-14', -20, foodId);
    await tx('2026-01-02', -500, flightsId);
    const s = await suggester.suggest(tripId);
    expect(s.map((x) => x.group)).toEqual(['before', 'during', 'other', 'after']);
  });

  it.each([
    ['2025-09-15', true],
    ['2025-09-14', false],
  ])('before window edge %s suggested=%s', async (date, expected) => {
    await tx(date, -900, flightsId);
    expect((await suggester.suggest(tripId)).length).toBe(expected ? 1 : 0);
  });

  it.each([
    ['2026-02-11', true],
    ['2026-02-12', false],
  ])('after window edge %s suggested=%s', async (date, expected) => {
    await tx(date, 50, shopId);
    expect((await suggester.suggest(tripId)).length).toBe(expected ? 1 : 0);
  });

  it('sayssingularDayAtOneDay', async () => {
    await tx('2026-01-12', -900, flightsId);
    await tx('2026-01-22', 50, shopId);
    expect((await suggester.suggest(tripId)).map((s) => s.reason)).toEqual([
      '1 day before',
      '1 day after',
    ]);
  });

  it('countMatchesSuggest', async () => {
    await tx('2026-01-15', -40, foodId);
    await tx('2026-01-16', -12, shopId);
    expect(await suggester.count(tripId)).toBe(2);
  });
});
