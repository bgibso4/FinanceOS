import type { PrismaClient } from '@prisma/client';
import type { PassStep, PassSummary } from './pass';

/** The last finished pass, or null when none has finished yet. */
export async function readPassRecord(
  prisma: PrismaClient
): Promise<{ finishedAt: Date; failures: PassStep[] } | null> {
  const row = await prisma.userSettings.findFirst();
  if (!row?.scheduledSyncFinishedAt) return null;
  return {
    finishedAt: row.scheduledSyncFinishedAt,
    failures: JSON.parse(row.scheduledSyncFailures ?? '[]') as PassStep[],
  };
}

export async function writePassRecord(prisma: PrismaClient, s: PassSummary): Promise<void> {
  const data = {
    scheduledSyncFinishedAt: s.finishedAt,
    scheduledSyncFailures: JSON.stringify(s.failures),
  };
  const row = await prisma.userSettings.findFirst();
  if (row) await prisma.userSettings.update({ where: { id: row.id }, data });
  else await prisma.userSettings.create({ data });
}
