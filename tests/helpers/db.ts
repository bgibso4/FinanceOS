import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

let prisma: PrismaClient | null = null;
let currentDbPath: string | null = null;

/**
 * Set up a fresh test database
 * Uses SQLite for fast, isolated testing
 * Each test suite gets a unique database to avoid conflicts
 */
export async function setupTestDb(): Promise<PrismaClient> {
  // Generate unique DB path for this test suite
  const uniqueId = uuid().slice(0, 8);
  currentDbPath = path.join(process.cwd(), 'prisma', `test-${uniqueId}.db`);
  const testDbUrl = `file:${currentDbPath}`;

  // Clean up any existing test database at this path
  if (fs.existsSync(currentDbPath)) {
    fs.unlinkSync(currentDbPath);
  }

  // Set environment variable for Prisma
  process.env.DATABASE_URL = testDbUrl;

  // Push schema to create tables
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: testDbUrl },
  });

  // Create Prisma client
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: testDbUrl,
      },
    },
  });

  await prisma.$connect();
  return prisma;
}

/**
 * Clean up and disconnect from test database
 */
export async function teardownTestDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }

  // Remove test database file
  if (currentDbPath && fs.existsSync(currentDbPath)) {
    try {
      fs.unlinkSync(currentDbPath);
    } catch {
      // Ignore cleanup errors
    }
  }
  currentDbPath = null;
}

/**
 * Reset all tables between tests (faster than recreating db)
 */
export async function resetTestDb(): Promise<void> {
  if (!prisma) {
    throw new Error('Test database not initialized. Call setupTestDb first.');
  }

  // Delete in order respecting foreign keys
  await prisma.transaction.deleteMany();
  await prisma.recurringTransaction.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.categoryBudget.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.tellerConnection.deleteMany();
  await prisma.tellerEnrollment.deleteMany();
  await prisma.plaidConnection.deleteMany();
  await prisma.plaidEnrollment.deleteMany();
  await prisma.account.deleteMany();
  await prisma.category.deleteMany();
  await prisma.monthlySnapshot.deleteMany();
  await prisma.exchangeRate.deleteMany();
  await prisma.inflationRate.deleteMany();
  await prisma.userSettings.deleteMany();
}

/**
 * Get the current test Prisma client
 */
export function getTestPrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('Test database not initialized. Call setupTestDb first.');
  }
  return prisma;
}
