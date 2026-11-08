import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPriceIndexServices } from '@/lib/price-index/services';
import type { PriceIndexResponse } from '@/lib/price-index/api';
import { INDEX_REGIONS, REGION_NAMES } from '@/lib/price-index/types';

/** Stored consumer price index months for every region, and the region reports use. Never fetches. */
export async function GET() {
  try {
    const { store, sources } = await getPriceIndexServices();
    const [all, settings] = await Promise.all([store.all(), prisma.userSettings.findFirst()]);
    const regions = INDEX_REGIONS.map((region) => ({
      region,
      name: REGION_NAMES[region],
      attribution: sources.find((s) => s.region === region)?.attribution ?? '',
      fetchedAt: all[region].fetchedAt?.toISOString() ?? null,
      months: all[region].months,
    }));
    const stored = settings?.inflationRegion;
    // A restored backup can carry any string.
    const selected = INDEX_REGIONS.find((r) => r === stored) ?? 'US';
    const body: PriceIndexResponse = { selected, regions };
    return NextResponse.json(body);
  } catch (error) {
    console.error('Failed to fetch price index:', error);
    return NextResponse.json({ error: 'Failed to fetch price index' }, { status: 500 });
  }
}
