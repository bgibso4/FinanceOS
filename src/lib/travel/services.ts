import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@/lib/clock';
import { TripSuggester } from './suggestions';
import { TravelTotals } from './totals';

export type TravelServices = {
  totals: TravelTotals;
  suggester: TripSuggester;
};

/** The one place Travel services are wired. Omitted `clock` uses the real one. */
export function createTravelServices(deps: {
  prisma: PrismaClient;
  clock?: Clock;
}): TravelServices {
  return { totals: new TravelTotals(deps.prisma), suggester: new TripSuggester(deps.prisma) };
}

let instance: TravelServices | null = null;

/** Production services: the app Prisma client, built on first use. */
export async function getTravelServices(): Promise<TravelServices> {
  if (!instance) {
    const { prisma } = await import('@/lib/prisma');
    instance = createTravelServices({ prisma });
  }
  return instance;
}
