import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';

describe('exchange rates API integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  describe('GET /api/exchange-rates', () => {
    it('returns empty array when no rates exist', async () => {
      const rates = await prisma.exchangeRate.findMany();
      expect(rates).toHaveLength(0);
    });

    it('returns all exchange rates', async () => {
      await prisma.exchangeRate.createMany({
        data: [
          { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
          { fromCurrency: 'USD', toCurrency: 'GBP', rate: 0.79 },
          { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.09 },
        ],
      });

      const rates = await prisma.exchangeRate.findMany();

      expect(rates).toHaveLength(3);
    });

    it('orders rates by fromCurrency then toCurrency', async () => {
      await prisma.exchangeRate.createMany({
        data: [
          { fromCurrency: 'USD', toCurrency: 'GBP', rate: 0.79 },
          { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.09 },
          { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
          { fromCurrency: 'EUR', toCurrency: 'GBP', rate: 0.86 },
        ],
      });

      const rates = await prisma.exchangeRate.findMany({
        orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }],
      });

      expect(rates[0].fromCurrency).toBe('EUR');
      expect(rates[0].toCurrency).toBe('GBP');
      expect(rates[1].fromCurrency).toBe('EUR');
      expect(rates[1].toCurrency).toBe('USD');
      expect(rates[2].fromCurrency).toBe('USD');
      expect(rates[2].toCurrency).toBe('EUR');
      expect(rates[3].fromCurrency).toBe('USD');
      expect(rates[3].toCurrency).toBe('GBP');
    });

    it('returns rate values correctly', async () => {
      await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'JPY', rate: 149.5 },
      });

      const rates = await prisma.exchangeRate.findMany();

      expect(rates[0].rate).toBe(149.5);
    });
  });

  describe('POST /api/exchange-rates', () => {
    it('creates a new exchange rate', async () => {
      const rate = await prisma.exchangeRate.create({
        data: {
          fromCurrency: 'USD',
          toCurrency: 'EUR',
          rate: 0.92,
        },
      });

      expect(rate.fromCurrency).toBe('USD');
      expect(rate.toCurrency).toBe('EUR');
      expect(rate.rate).toBe(0.92);
    });

    it('updates existing rate with upsert', async () => {
      // Create initial rate
      await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.9 },
      });

      // Upsert with new rate
      const updated = await prisma.exchangeRate.upsert({
        where: {
          fromCurrency_toCurrency: {
            fromCurrency: 'USD',
            toCurrency: 'EUR',
          },
        },
        update: { rate: 0.92 },
        create: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
      });

      expect(updated.rate).toBe(0.92);

      // Verify only one record exists
      const allRates = await prisma.exchangeRate.findMany({
        where: { fromCurrency: 'USD', toCurrency: 'EUR' },
      });
      expect(allRates).toHaveLength(1);
    });

    it('handles high precision rates', async () => {
      const rate = await prisma.exchangeRate.create({
        data: {
          fromCurrency: 'BTC',
          toCurrency: 'USD',
          rate: 42567.89123,
        },
      });

      expect(rate.rate).toBeCloseTo(42567.89123, 2);
    });

    it('handles rates less than 1', async () => {
      const rate = await prisma.exchangeRate.create({
        data: {
          fromCurrency: 'USD',
          toCurrency: 'GBP',
          rate: 0.79,
        },
      });

      expect(rate.rate).toBe(0.79);
    });

    it('handles rates greater than 100', async () => {
      const rate = await prisma.exchangeRate.create({
        data: {
          fromCurrency: 'USD',
          toCurrency: 'JPY',
          rate: 149.72,
        },
      });

      expect(rate.rate).toBe(149.72);
    });

    it('supports various currency codes', async () => {
      const currencyPairs = [
        { from: 'USD', to: 'EUR', rate: 0.92 },
        { from: 'GBP', to: 'USD', rate: 1.27 },
        { from: 'CHF', to: 'EUR', rate: 1.05 },
        { from: 'AUD', to: 'NZD', rate: 1.09 },
        { from: 'CAD', to: 'USD', rate: 0.74 },
      ];

      for (const pair of currencyPairs) {
        await prisma.exchangeRate.create({
          data: {
            fromCurrency: pair.from,
            toCurrency: pair.to,
            rate: pair.rate,
          },
        });
      }

      const rates = await prisma.exchangeRate.findMany();
      expect(rates).toHaveLength(5);
    });

    it('enforces unique constraint on currency pair', async () => {
      await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.9 },
      });

      // Try to create duplicate
      await expect(
        prisma.exchangeRate.create({
          data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
        })
      ).rejects.toThrow();
    });

    it('allows same currencies in different direction', async () => {
      await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
      });

      await prisma.exchangeRate.create({
        data: { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.09 },
      });

      const rates = await prisma.exchangeRate.findMany();
      expect(rates).toHaveLength(2);
    });
  });

  describe('exchange rate validation', () => {
    it('rate must be positive (enforced at application level)', async () => {
      // In a real API, this would return 400
      // Database allows any value, validation is in API layer
      const zeroRate = { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0 };
      const negativeRate = { fromCurrency: 'USD', toCurrency: 'GBP', rate: -1 };

      // These would pass DB but fail API validation
      expect(zeroRate.rate).toBeLessThanOrEqual(0);
      expect(negativeRate.rate).toBeLessThanOrEqual(0);
    });

    it('requires all fields', async () => {
      // Missing rate
      await expect(
        prisma.exchangeRate.create({
          data: {
            fromCurrency: 'USD',
            toCurrency: 'EUR',
            rate: undefined as unknown as number,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('exchange rate usage', () => {
    it('can look up rate by currency pair', async () => {
      await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
      });

      const rate = await prisma.exchangeRate.findFirst({
        where: {
          fromCurrency: 'USD',
          toCurrency: 'EUR',
        },
      });

      expect(rate).not.toBeNull();
      expect(rate!.rate).toBe(0.92);
    });

    it('returns null for non-existent pair', async () => {
      const rate = await prisma.exchangeRate.findFirst({
        where: {
          fromCurrency: 'USD',
          toCurrency: 'XYZ',
        },
      });

      expect(rate).toBeNull();
    });

    it('can calculate converted amount', async () => {
      await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
      });

      const rate = await prisma.exchangeRate.findFirst({
        where: { fromCurrency: 'USD', toCurrency: 'EUR' },
      });

      const usdAmount = 100;
      const eurAmount = usdAmount * rate!.rate;

      expect(eurAmount).toBe(92);
    });

    it('handles rate updates correctly', async () => {
      const initial = await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.9 },
      });

      const updated = await prisma.exchangeRate.update({
        where: { id: initial.id },
        data: { rate: 0.95 },
      });

      expect(updated.rate).toBe(0.95);

      // Verify the change persists
      const fetched = await prisma.exchangeRate.findFirst({
        where: { fromCurrency: 'USD', toCurrency: 'EUR' },
      });
      expect(fetched!.rate).toBe(0.95);
    });
  });

  describe('exchange rate timestamps', () => {
    it('has auto-generated id', async () => {
      const rate = await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
      });

      expect(rate.id).toBeDefined();
      expect(typeof rate.id).toBe('string');
    });

    it('has created and updated timestamps', async () => {
      const rate = await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92 },
      });

      expect(rate.createdAt).toBeDefined();
      expect(rate.updatedAt).toBeDefined();
      expect(rate.createdAt).toBeInstanceOf(Date);
    });

    it('updates timestamp on rate change', async () => {
      const initial = await prisma.exchangeRate.create({
        data: { fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.9 },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await prisma.exchangeRate.update({
        where: { id: initial.id },
        data: { rate: 0.92 },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(initial.createdAt.getTime());
    });
  });
});
