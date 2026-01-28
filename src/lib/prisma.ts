import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Connection pool configuration to limit memory usage
// For SQLite, connection_limit controls prepared statement caching
const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const pooledUrl = databaseUrl.includes('?')
  ? `${databaseUrl}&connection_limit=5&pool_timeout=10`
  : `${databaseUrl}?connection_limit=5&pool_timeout=10`;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
    datasources: {
      db: {
        url: pooledUrl,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown to release connections
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
