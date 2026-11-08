import fs from 'fs';
import path from 'path';
import { expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createAccountData, createCategoryData } from '../../helpers/factories';

export const TRIP_13 = 'trip-13_2026-11-08_export.csv';
export const TRIP_PAIR = 'trip-pair_2026-11-08_export.csv';

export const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/splitwise', name), 'utf8');

/** Row starts in trip-pair, and an edit of stay 1's cost and your amount. */
export const STAY_1 = '2026-10-10,Rental stay 1,';
export const STAY_1_EDITED = '2026-10-10,Rental stay 1,Hotel,600.00,USD,300.00,-300.00';
export const STAY_2 = '2026-10-10,Rental stay 2,';

/** `text` with the line starting `start` replaced by `replacement`, or removed when null. */
export function withLine(text: string, start: string, replacement: string | null): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(start));
  expect(i).toBeGreaterThan(0);
  if (replacement === null) lines.splice(i, 1);
  else lines[i] = replacement;
  return lines.join('\n');
}

/** The Splitwise account and the categories the fallback map lands on. */
export async function seedSplitwise(prisma: PrismaClient) {
  const accountId = (
    await prisma.account.create({
      data: createAccountData({ name: 'Splitwise', type: 'other', institution: 'Splitwise' }),
    })
  ).id;
  const travel = await prisma.category.create({ data: createCategoryData({ name: '✈️ Travel' }) });
  const lodging = (
    await prisma.category.create({
      data: createCategoryData({ name: '🏘️ Lodging', parentId: travel.id }),
    })
  ).id;
  await prisma.category.create({
    data: createCategoryData({ name: '🚙 Rideshare (Uber/Lyft/etc.)', parentId: travel.id }),
  });
  await prisma.category.create({ data: createCategoryData({ name: '🛒 Groceries' }) });
  return { accountId, lodging };
}
