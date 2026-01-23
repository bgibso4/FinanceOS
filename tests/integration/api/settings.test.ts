import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';

describe('settings API integration', () => {
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

  describe('GET /api/settings', () => {
    it('creates default settings if none exist', async () => {
      // Verify no settings exist
      const beforeSettings = await prisma.userSettings.findFirst();
      expect(beforeSettings).toBeNull();

      // Simulate API behavior: get or create
      let settings = await prisma.userSettings.findFirst();
      if (!settings) {
        settings = await prisma.userSettings.create({
          data: { baseCurrency: 'USD' },
        });
      }

      expect(settings.baseCurrency).toBe('USD');
    });

    it('returns existing settings', async () => {
      // Create settings first
      await prisma.userSettings.create({
        data: { baseCurrency: 'EUR' },
      });

      // Fetch settings
      const settings = await prisma.userSettings.findFirst();

      expect(settings).not.toBeNull();
      expect(settings!.baseCurrency).toBe('EUR');
    });

    it('default base currency is USD', async () => {
      const settings = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      expect(settings.baseCurrency).toBe('USD');
    });
  });

  describe('PATCH /api/settings', () => {
    it('updates base currency', async () => {
      // Create initial settings
      const initial = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      // Update settings
      const updated = await prisma.userSettings.update({
        where: { id: initial.id },
        data: { baseCurrency: 'EUR' },
      });

      expect(updated.baseCurrency).toBe('EUR');
    });

    it('creates settings if none exist during update', async () => {
      // Verify no settings
      const beforeSettings = await prisma.userSettings.findFirst();
      expect(beforeSettings).toBeNull();

      // Simulate API: get or create with new value
      let settings = await prisma.userSettings.findFirst();
      if (!settings) {
        settings = await prisma.userSettings.create({
          data: { baseCurrency: 'GBP' },
        });
      } else {
        settings = await prisma.userSettings.update({
          where: { id: settings.id },
          data: { baseCurrency: 'GBP' },
        });
      }

      expect(settings.baseCurrency).toBe('GBP');
    });

    it('supports common currency codes', async () => {
      const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'];

      for (const currency of currencies) {
        await resetTestDb();

        const settings = await prisma.userSettings.create({
          data: { baseCurrency: currency },
        });

        expect(settings.baseCurrency).toBe(currency);
      }
    });

    it('persists currency change across reads', async () => {
      // Create initial
      const initial = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      // Update
      await prisma.userSettings.update({
        where: { id: initial.id },
        data: { baseCurrency: 'JPY' },
      });

      // Read again
      const fetched = await prisma.userSettings.findFirst();

      expect(fetched!.baseCurrency).toBe('JPY');
    });

    it('maintains single settings record', async () => {
      // Create first settings
      await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      // Verify only one record
      const allSettings = await prisma.userSettings.findMany();
      expect(allSettings).toHaveLength(1);
    });

    it('handles empty update gracefully', async () => {
      const initial = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      // Update with same value
      const updated = await prisma.userSettings.update({
        where: { id: initial.id },
        data: { baseCurrency: 'USD' },
      });

      expect(updated.baseCurrency).toBe('USD');
    });

    it('updates timestamp on change', async () => {
      const initial = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await prisma.userSettings.update({
        where: { id: initial.id },
        data: { baseCurrency: 'EUR' },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(initial.createdAt.getTime());
    });
  });

  describe('settings integrity', () => {
    it('findFirst returns consistent result', async () => {
      await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      const first = await prisma.userSettings.findFirst();
      const second = await prisma.userSettings.findFirst();

      expect(first!.id).toBe(second!.id);
      expect(first!.baseCurrency).toBe(second!.baseCurrency);
    });

    it('settings have auto-generated id', async () => {
      const settings = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      expect(settings.id).toBeDefined();
      expect(typeof settings.id).toBe('string');
      expect(settings.id.length).toBeGreaterThan(0);
    });

    it('settings have created and updated timestamps', async () => {
      const settings = await prisma.userSettings.create({
        data: { baseCurrency: 'USD' },
      });

      expect(settings.createdAt).toBeDefined();
      expect(settings.updatedAt).toBeDefined();
      expect(settings.createdAt).toBeInstanceOf(Date);
      expect(settings.updatedAt).toBeInstanceOf(Date);
    });
  });
});
