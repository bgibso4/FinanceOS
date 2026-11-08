import type { PrismaClient } from '@prisma/client';
import { INDEX_REGIONS, type IndexObservation, type IndexRegion, type MonthKey } from './types';

export type StoredIndex = { months: IndexObservation[]; fetchedAt: Date | null };

/** The only code that touches the PriceIndexMonth table. */
export class PriceIndexStore {
  constructor(private readonly prisma: PrismaClient) {}

  async lastMonth(region: IndexRegion): Promise<MonthKey | null> {
    const row = await this.prisma.priceIndexMonth.findFirst({
      where: { region },
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    return row?.month ?? null;
  }

  async firstMonth(region: IndexRegion): Promise<MonthKey | null> {
    const row = await this.prisma.priceIndexMonth.findFirst({
      where: { region },
      orderBy: { month: 'asc' },
      select: { month: true },
    });
    return row?.month ?? null;
  }

  /** Inserts or revises each month, all or none. */
  async save(region: IndexRegion, obs: IndexObservation[]): Promise<void> {
    await this.prisma.$transaction(
      obs.map(({ month, value }) =>
        this.prisma.priceIndexMonth.upsert({
          where: { region_month: { region, month } },
          update: { value },
          create: { region, month, value },
        })
      )
    );
  }

  /** Every region's months, oldest first, with when the region was last written. */
  async all(): Promise<Record<IndexRegion, StoredIndex>> {
    const rows = await this.prisma.priceIndexMonth.findMany({ orderBy: { month: 'asc' } });
    const result = {} as Record<IndexRegion, StoredIndex>;
    for (const region of INDEX_REGIONS) {
      const mine = rows.filter((r) => r.region === region);
      result[region] = {
        months: mine.map(({ month, value }) => ({ month, value })),
        fetchedAt: mine.length
          ? new Date(Math.max(...mine.map((r) => r.updatedAt.getTime())))
          : null,
      };
    }
    return result;
  }
}
