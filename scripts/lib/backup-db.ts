import { existsSync, statSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

/** Backs up the live database via the open connection; returns the backup path. */
export async function backupDatabase(prisma: PrismaClient): Promise<string> {
  const rows =
    await prisma.$queryRawUnsafe<{ name: string; file: string }[]>('PRAGMA database_list');
  const file = rows.find((r) => r.name === 'main')?.file;
  if (!file) throw new Error('Could not determine the main database file; aborting');
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  if (!existsSync(backup) || statSync(backup).size === 0) {
    throw new Error(`Backup ${backup} is missing or empty; aborting before any write`);
  }
  return backup;
}
