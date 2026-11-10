import type { PrismaClient } from '@prisma/client';
import { splitwiseCategoriser } from './categories';
import { SplitwiseImporter } from './importer';
import { SplitwiseStore } from './store';

/** The one place the Splitwise import is wired. */
export function createSplitwiseImporter(deps: { prisma: PrismaClient }): SplitwiseImporter {
  return new SplitwiseImporter(new SplitwiseStore(deps.prisma), splitwiseCategoriser(deps.prisma));
}

let instance: SplitwiseImporter | null = null;

/** The production importer: the app Prisma client, built on first use. */
export async function getSplitwiseImporter(): Promise<SplitwiseImporter> {
  if (!instance) {
    const { prisma } = await import('@/lib/prisma');
    instance = createSplitwiseImporter({ prisma });
  }
  return instance;
}
