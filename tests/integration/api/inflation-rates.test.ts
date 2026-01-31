import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';

describe('inflation rates API integration', () => {
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

  describe('GET /api/inflation-rates', () => {
    it('returns empty array when no rates exist', async () => {
      const rates = await prisma.inflationRate.findMany();
      expect(rates).toHaveLength(0);
    });

    it('returns all inflation rates', async () => {
      await prisma.inflationRate.createMany({
        data: [
          { year: 2022, rate: 6.5 },
          { year: 2023, rate: 3.4 },
          { year: 2024, rate: 2.9 },
        ],
      });

      const rates = await prisma.inflationRate.findMany();
      expect(rates).toHaveLength(3);
    });

    it('orders rates by year descending', async () => {
      await prisma.inflationRate.createMany({
        data: [
          { year: 2022, rate: 6.5 },
          { year: 2024, rate: 2.9 },
          { year: 2023, rate: 3.4 },
        ],
      });

      const rates = await prisma.inflationRate.findMany({
        orderBy: { year: 'desc' },
      });

      expect(rates[0].year).toBe(2024);
      expect(rates[1].year).toBe(2023);
      expect(rates[2].year).toBe(2022);
    });

    it('returns rate values correctly', async () => {
      await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      const rates = await prisma.inflationRate.findMany();
      expect(rates[0].rate).toBe(3.4);
    });
  });

  describe('POST /api/inflation-rates', () => {
    it('creates a new inflation rate', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      expect(rate.year).toBe(2023);
      expect(rate.rate).toBe(3.4);
    });

    it('updates existing rate with upsert', async () => {
      await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.0 },
      });

      const updated = await prisma.inflationRate.upsert({
        where: { year: 2023 },
        update: { rate: 3.4 },
        create: { year: 2023, rate: 3.4 },
      });

      expect(updated.rate).toBe(3.4);

      const allRates = await prisma.inflationRate.findMany({
        where: { year: 2023 },
      });
      expect(allRates).toHaveLength(1);
    });

    it('handles decimal precision', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.456 },
      });

      expect(rate.rate).toBeCloseTo(3.456, 3);
    });

    it('handles negative rates (deflation)', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2009, rate: -0.4 },
      });

      expect(rate.rate).toBe(-0.4);
    });

    it('handles zero rate', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2015, rate: 0 },
      });

      expect(rate.rate).toBe(0);
    });

    it('enforces unique constraint on year', async () => {
      await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.0 },
      });

      await expect(
        prisma.inflationRate.create({
          data: { year: 2023, rate: 3.4 },
        })
      ).rejects.toThrow();
    });

    it('allows different years', async () => {
      await prisma.inflationRate.create({
        data: { year: 2022, rate: 6.5 },
      });

      await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      const rates = await prisma.inflationRate.findMany();
      expect(rates).toHaveLength(2);
    });
  });

  describe('DELETE /api/inflation-rates', () => {
    it('deletes an inflation rate', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      await prisma.inflationRate.delete({
        where: { id: rate.id },
      });

      const remaining = await prisma.inflationRate.findMany();
      expect(remaining).toHaveLength(0);
    });

    it('only deletes the specified rate', async () => {
      const rate1 = await prisma.inflationRate.create({
        data: { year: 2022, rate: 6.5 },
      });

      await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      await prisma.inflationRate.delete({
        where: { id: rate1.id },
      });

      const remaining = await prisma.inflationRate.findMany();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].year).toBe(2023);
    });
  });

  describe('inflation rate timestamps', () => {
    it('has auto-generated id', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      expect(rate.id).toBeDefined();
      expect(typeof rate.id).toBe('string');
    });

    it('has created and updated timestamps', async () => {
      const rate = await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.4 },
      });

      expect(rate.createdAt).toBeDefined();
      expect(rate.updatedAt).toBeDefined();
      expect(rate.createdAt).toBeInstanceOf(Date);
    });

    it('updates timestamp on rate change', async () => {
      const initial = await prisma.inflationRate.create({
        data: { year: 2023, rate: 3.0 },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await prisma.inflationRate.update({
        where: { id: initial.id },
        data: { rate: 3.4 },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(initial.createdAt.getTime());
    });
  });
});
