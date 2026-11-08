import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@/lib/clock';
import { monthOf } from './months';
import { PriceIndexHistory } from './history';
import { PriceIndexStore } from './store';
import type { PriceIndexSource } from './types';

export type PriceIndexServices = {
  store: PriceIndexStore;
  history: PriceIndexHistory;
  sources: PriceIndexSource[];
};

/** The one place the price index store, fill service and sources are wired. */
export function createPriceIndexServices(deps: {
  prisma: PrismaClient;
  sources: PriceIndexSource[];
  clock?: Clock;
}): PriceIndexServices {
  const { prisma, sources, clock } = deps;
  const store = new PriceIndexStore(prisma);
  const firstNeededMonth = async () => {
    const first = await prisma.netWorthSnapshot.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    return first ? monthOf(first.date) : null;
  };
  return {
    store,
    history: new PriceIndexHistory(store, sources, firstNeededMonth, clock),
    sources,
  };
}

let instance: PriceIndexServices | null = null;

/** Production services: the app Prisma client and both agencies' sources, built on first use. */
export async function getPriceIndexServices(): Promise<PriceIndexServices> {
  if (!instance) {
    const { prisma } = await import('@/lib/prisma');
    const [{ BlsCpiSource }, { StatCanCpiSource }] = await Promise.all([
      import('./sources/bls'),
      import('./sources/statcan'),
    ]);
    instance ??= createPriceIndexServices({
      prisma,
      sources: [new BlsCpiSource(), new StatCanCpiSource()],
    });
  }
  return instance;
}
