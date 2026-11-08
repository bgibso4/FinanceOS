import { PrismaClient } from '@prisma/client';
import { processGlobal } from '@/lib/process-global';

// Connection pool configuration to limit memory usage
// For SQLite, connection_limit controls prepared statement caching
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const pooledUrl = databaseUrl.includes('?')
  ? `${databaseUrl}&connection_limit=5&pool_timeout=10`
  : `${databaseUrl}?connection_limit=5&pool_timeout=10`;

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: ['warn', 'error'],
    datasources: {
      db: {
        url: pooledUrl,
      },
    },
  });
  // Graceful shutdown to release connections
  process.on('beforeExit', async () => {
    await client.$disconnect();
  });
  return client;
}

/** One client per process, in every environment: see processGlobal. */
export const prisma = processGlobal('financeos:prisma', createPrismaClient);
