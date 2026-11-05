import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@/lib/clock';
import { TravelBudget } from './budget';
import { TripSuggester } from './suggestions';
import { TravelTotals } from './totals';
import { TripStore } from './trips';

export type TravelServices = {
  totals: TravelTotals;
  suggester: TripSuggester;
  trips: TripStore;
  budget: TravelBudget;
};

/** The one place Travel services are wired. Omitted `clock` uses the real one. */
export function createTravelServices(deps: {
  prisma: PrismaClient;
  clock?: Clock;
}): TravelServices {
  return {
    totals: new TravelTotals(deps.prisma),
    suggester: new TripSuggester(deps.prisma),
    trips: new TripStore(deps.prisma),
    budget: new TravelBudget(deps.prisma, deps.clock),
  };
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
