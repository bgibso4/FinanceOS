import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData, createTransactionData } from '../../../helpers/factories';
import { fakeProvider, day, expectWarning } from '../../../helpers/investments';
import { ExchangeRateHistory } from '@/lib/fx/rate-history';
import { fixedClock } from '@/lib/clock';
import { PriceProviderError } from '@/lib/prices/types';

const NOW = '2026-11-07T15:00:00Z';
const SYMBOL = 'CAD>USD'; // fakeProvider's neutral pair symbol

describe('ExchangeRateHistory', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    await prisma.userSettings.create({ data: { baseCurrency: 'USD' } });
  });

  const cadAccount = async () => {
    const data = createAccountData({ currency: 'CAD' });
    await prisma.account.create({ data });
    return data.id!;
  };
  const stored = () =>
    prisma.exchangeRate
      .findMany({ orderBy: { date: 'asc' } })
      .then((rows) => rows.map((r) => [r.date.toISOString().slice(0, 10), r.rate] as const));
  const history = (closes: Record<string, number>, errors: PriceProviderError[] = []) => {
    const { provider, calls } = fakeProvider({
      closes: { [SYMBOL]: closes },
      errors: { [SYMBOL]: errors },
    });
    return { fx: new ExchangeRateHistory(prisma, provider, fixedClock(NOW)), calls };
  };

  it('backfillStartsAtFirstCadActivity', async () => {
    const accountId = await cadAccount();
    await prisma.transaction.create({
      data: createTransactionData(accountId, { date: day('2025-03-04') }),
    });
    await prisma.transaction.create({
      data: createTransactionData(accountId, { date: day('2025-06-01') }),
    });
    const { fx, calls } = history({ '2025-03-04': 0.7, '2025-03-05': 0.71 });
    const result = await fx.fill();
    expect(calls).toEqual([{ symbol: SYMBOL, from: '2025-03-04', to: '2026-11-07' }]);
    expect(result).toEqual({ pairs: ['CAD->USD'], days: 2, failed: [] });
    expect(await stored()).toEqual([
      ['2025-03-04', 0.7],
      ['2025-03-05', 0.71],
    ]);
  });

  it('backfillStartsAtEarliestStoredBalanceWhenOlder', async () => {
    const accountId = await cadAccount();
    await prisma.transaction.create({
      data: createTransactionData(accountId, { date: day('2025-06-01') }),
    });
    await prisma.accountBalance.create({
      data: { accountId, date: day('2025-02-01'), balance: 5, currency: 'CAD', source: 'synced' },
    });
    const { fx, calls } = history({});
    await fx.fill();
    expect(calls[0].from).toBe('2025-02-01');
  });

  it('ignoresActivityOnOtherCurrencies', async () => {
    await cadAccount();
    const usd = createAccountData({ currency: 'USD' });
    await prisma.account.create({ data: usd });
    await prisma.transaction.create({
      data: createTransactionData(usd.id!, { date: day('2020-01-01') }),
    });
    const { fx, calls } = history({});
    await fx.fill();
    expect(calls[0].from).toBe('2026-11-07');
  });

  it('fillsGapAfterDowntime', async () => {
    await cadAccount();
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', date: day('2026-11-01'), rate: 0.72 },
    });
    const { fx, calls } = history({
      '2026-11-01': 0.72,
      '2026-11-02': 0.725,
      '2026-11-03': 0.73,
      '2026-11-06': 0.73,
    });
    const result = await fx.fill();
    expect(calls).toEqual([{ symbol: SYMBOL, from: '2026-11-01', to: '2026-11-07' }]);
    expect(result.days).toBe(4);
    expect((await stored()).map(([d]) => d)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-06',
    ]);
  });

  it('todaysRowIsUpdated', async () => {
    await cadAccount();
    await history({ '2026-11-07': 0.73 }).fx.fill();
    await history({ '2026-11-07': 0.74 }).fx.fill();
    expect(await stored()).toEqual([['2026-11-07', 0.74]]);
  });

  it.each([
    ['zero', { '2026-11-06': 0.72, '2026-11-07': 0 }],
    ['negative', { '2026-11-06': 0.72, '2026-11-07': -0.7 }],
    ['NaN', { '2026-11-06': 0.72, '2026-11-07': NaN }],
    ['up 25%', { '2026-11-06': 0.72, '2026-11-07': 0.9 }],
    ['down 25%', { '2026-11-06': 0.72, '2026-11-07': 0.54 }],
  ])('nonsenseRateWritesNothing (%s)', async (_name, closes) => {
    await cadAccount();
    await prisma.exchangeRate.create({
      data: { fromCurrency: 'CAD', toCurrency: 'USD', date: day('2026-11-05'), rate: 0.72 },
    });
    const { fx } = history(closes);
    const result = await expectWarning('CAD->USD', () => fx.fill());
    expect(result).toEqual({ pairs: ['CAD->USD'], days: 0, failed: ['CAD->USD'] });
    expect(await stored()).toEqual([['2026-11-05', 0.72]]);
  });

  it('providerErrorWritesNothing', async () => {
    await cadAccount();
    const { fx } = history({ '2026-11-07': 0.73 }, [new PriceProviderError('network', 'down')]);
    const result = await expectWarning('CAD->USD', () => fx.fill());
    expect(result.failed).toEqual(['CAD->USD']);
    expect(await stored()).toEqual([]);
  });

  it('noForeignAccountsNoPairs', async () => {
    await prisma.account.create({ data: createAccountData({ currency: 'USD' }) });
    const { fx, calls } = history({});
    expect(await fx.fill()).toEqual({ pairs: [], days: 0, failed: [] });
    expect(calls).toEqual([]);
  });

  it('inactiveAccountsDoNotMakePairs', async () => {
    await prisma.account.create({ data: createAccountData({ currency: 'CAD', isActive: false }) });
    const { fx } = history({});
    expect((await fx.fill()).pairs).toEqual([]);
  });
});
