/**
 * Cloud Sync - Database Export/Import
 *
 * Handles exporting the database to a sync payload and importing from one.
 * Excludes Plaid/Teller tables (device-local only).
 */

import { prisma as defaultPrisma } from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';
import type {
  SyncPayload,
  SyncData,
  SyncMetadata,
  AccountExport,
  TransactionExport,
  CategoryExport,
  RuleExport,
  CategoryBudgetExport,
  MonthlySnapshotExport,
  NetWorthSnapshotExport,
  ExchangeRateExport,
  UserSettingsExport,
} from './types';
import { validateSyncPayload } from './types';

// Allow tests to inject a different Prisma client
let prismaInstance: PrismaClient = defaultPrisma;

export function setPrismaClient(client: PrismaClient): void {
  prismaInstance = client;
}

export function resetPrismaClient(): void {
  prismaInstance = defaultPrisma;
}

function getPrisma(): PrismaClient {
  return prismaInstance;
}

/**
 * Get or create a unique device ID for this device
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    // Server-side or test environment: generate a new one each time
    return crypto.randomUUID();
  }

  try {
    const storageKey = 'financeos-device-id';
    let deviceId = localStorage.getItem(storageKey);

    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(storageKey, deviceId);
    }

    return deviceId;
  } catch {
    // localStorage not available (e.g., in tests)
    return crypto.randomUUID();
  }
}

/**
 * Generate SHA-256 checksum of data for integrity verification
 */
export async function generateChecksum(data: SyncData): Promise<string> {
  const encoder = new TextEncoder();
  const jsonString = JSON.stringify(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(jsonString));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Export the entire database to a sync payload
 */
export async function exportDatabase(): Promise<SyncPayload> {
  // Fetch all data in parallel
  const [
    accounts,
    transactions,
    categories,
    rules,
    budgets,
    monthlySnapshots,
    netWorthSnapshots,
    exchangeRates,
    settings,
  ] = await Promise.all([
    getPrisma().account.findMany(),
    getPrisma().transaction.findMany(),
    getPrisma().category.findMany(),
    getPrisma().rule.findMany(),
    getPrisma().categoryBudget.findMany(),
    getPrisma().monthlySnapshot.findMany(),
    getPrisma().netWorthSnapshot.findMany(),
    getPrisma().exchangeRate.findMany(),
    getPrisma().userSettings.findFirst(),
  ]);

  // Transform to export format (convert dates to ISO strings)
  const data: SyncData = {
    accounts: accounts.map(
      (a): AccountExport => ({
        id: a.id,
        name: a.name,
        type: a.type,
        institution: a.institution,
        currency: a.currency,
        isActive: a.isActive,
        notes: a.notes,
        trackingMode: a.trackingMode,
        invertAmounts: a.invertAmounts,
        sortOrder: a.sortOrder,
        createdAt: a.createdAt.toISOString(),
      })
    ),
    transactions: transactions.map(
      (t): TransactionExport => ({
        id: t.id,
        date: t.date.toISOString(),
        amount: t.amount,
        accountId: t.accountId,
        merchant: t.merchant,
        merchantNormalized: t.merchantNormalized,
        categoryId: t.categoryId,
        tags: t.tags,
        note: t.note,
        isTransfer: t.isTransfer,
        transferGroupId: t.transferGroupId,
        confidenceScore: t.confidenceScore,
        externalId: t.externalId,
        importHash: t.importHash,
        isOffset: t.isOffset,
        linkedTransactionId: t.linkedTransactionId,
        createdAt: t.createdAt.toISOString(),
      })
    ),
    categories: categories.map(
      (c): CategoryExport => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        type: c.type,
        createdAt: c.createdAt.toISOString(),
      })
    ),
    rules: rules.map(
      (r): RuleExport => ({
        id: r.id,
        matchType: r.matchType,
        matchValue: r.matchValue,
        categoryId: r.categoryId,
        renameTo: r.renameTo,
        priority: r.priority,
        isEnabled: r.isEnabled,
        createdAt: r.createdAt.toISOString(),
      })
    ),
    budgets: budgets.map(
      (b): CategoryBudgetExport => ({
        id: b.id,
        month: b.month,
        categoryId: b.categoryId,
        limitAmount: b.limitAmount,
        createdAt: b.createdAt.toISOString(),
      })
    ),
    monthlySnapshots: monthlySnapshots.map(
      (s): MonthlySnapshotExport => ({
        id: s.id,
        month: s.month,
        incomeTotal: s.incomeTotal,
        spendingTotal: s.spendingTotal,
        savingsTotal: s.savingsTotal,
        savingsRatePct: s.savingsRatePct,
        categoryTotals: s.categoryTotals,
        merchantTotals: s.merchantTotals,
        createdAt: s.createdAt.toISOString(),
      })
    ),
    netWorthSnapshots: netWorthSnapshots.map(
      (s): NetWorthSnapshotExport => ({
        id: s.id,
        date: s.date.toISOString(),
        netWorth: s.netWorth,
        totalAssets: s.totalAssets,
        totalLiabilities: s.totalLiabilities,
        accountBalances: s.accountBalances,
        period: s.period,
        notes: s.notes,
        isAutomatic: s.isAutomatic,
        createdAt: s.createdAt.toISOString(),
      })
    ),
    exchangeRates: exchangeRates.map(
      (e): ExchangeRateExport => ({
        id: e.id,
        fromCurrency: e.fromCurrency,
        toCurrency: e.toCurrency,
        rate: e.rate,
        updatedAt: e.updatedAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })
    ),
    settings: settings
      ? ({
          id: settings.id,
          baseCurrency: settings.baseCurrency,
          updatedAt: settings.updatedAt.toISOString(),
          createdAt: settings.createdAt.toISOString(),
        } as UserSettingsExport)
      : null,
  };

  const checksum = await generateChecksum(data);

  const metadata: SyncMetadata = {
    recordCounts: {
      accounts: data.accounts.length,
      transactions: data.transactions.length,
      categories: data.categories.length,
      rules: data.rules.length,
      budgets: data.budgets.length,
      monthlySnapshots: data.monthlySnapshots.length,
      netWorthSnapshots: data.netWorthSnapshots.length,
      exchangeRates: data.exchangeRates.length,
    },
    checksum,
  };

  const payload: SyncPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    data,
    metadata,
  };

  return payload;
}

/**
 * Import a sync payload into the database
 * Replaces all existing data (except Plaid/Teller connections)
 */
export async function importDatabase(payload: SyncPayload): Promise<void> {
  // Validate the payload
  const validated = validateSyncPayload(payload);

  // Verify checksum
  const checksum = await generateChecksum(validated.data);
  if (checksum !== validated.metadata.checksum) {
    throw new Error('Sync payload checksum mismatch - data may be corrupted');
  }

  const { data } = validated;

  // Use a transaction to ensure atomicity
  await getPrisma().$transaction(async (tx) => {
    // Delete existing data (order matters due to foreign keys)
    // Keep Plaid/Teller tables untouched!
    await tx.transaction.deleteMany();
    await tx.categoryBudget.deleteMany();
    await tx.rule.deleteMany();
    await tx.category.deleteMany();
    await tx.monthlySnapshot.deleteMany();
    await tx.netWorthSnapshot.deleteMany();
    await tx.exchangeRate.deleteMany();
    await tx.userSettings.deleteMany();

    // Delete accounts but preserve Plaid/Teller connections
    // First, get accounts with connections
    const accountsWithConnections = await tx.account.findMany({
      where: {
        OR: [{ plaidConnection: { isNot: null } }, { tellerConnection: { isNot: null } }],
      },
      select: { id: true },
    });
    const connectedAccountIds = new Set(accountsWithConnections.map((a) => a.id));

    // Delete accounts without connections
    await tx.account.deleteMany({
      where: {
        id: { notIn: Array.from(connectedAccountIds) },
      },
    });

    // Import categories first (due to parent references)
    // Sort by parentId to ensure parents are created before children
    const sortedCategories = [...data.categories].sort((a, b) => {
      if (a.parentId === null && b.parentId !== null) return -1;
      if (a.parentId !== null && b.parentId === null) return 1;
      return 0;
    });

    for (const cat of sortedCategories) {
      await tx.category.upsert({
        where: { id: cat.id },
        create: {
          id: cat.id,
          name: cat.name,
          parentId: cat.parentId,
          type: cat.type,
          createdAt: new Date(cat.createdAt),
        },
        update: {
          name: cat.name,
          parentId: cat.parentId,
          type: cat.type,
        },
      });
    }

    // Import accounts (skip those with existing connections)
    for (const acc of data.accounts) {
      if (connectedAccountIds.has(acc.id)) {
        // Update existing connected account (but don't overwrite connection)
        await tx.account.update({
          where: { id: acc.id },
          data: {
            name: acc.name,
            type: acc.type,
            institution: acc.institution,
            currency: acc.currency,
            isActive: acc.isActive,
            notes: acc.notes,
            trackingMode: acc.trackingMode,
            invertAmounts: acc.invertAmounts,
            sortOrder: acc.sortOrder,
          },
        });
      } else {
        // Create new account
        await tx.account.create({
          data: {
            id: acc.id,
            name: acc.name,
            type: acc.type,
            institution: acc.institution,
            currency: acc.currency,
            isActive: acc.isActive,
            notes: acc.notes,
            trackingMode: acc.trackingMode,
            invertAmounts: acc.invertAmounts,
            sortOrder: acc.sortOrder,
            createdAt: new Date(acc.createdAt),
          },
        });
      }
    }

    // Import rules
    for (const rule of data.rules) {
      await tx.rule.create({
        data: {
          id: rule.id,
          matchType: rule.matchType,
          matchValue: rule.matchValue,
          categoryId: rule.categoryId,
          renameTo: rule.renameTo,
          priority: rule.priority,
          isEnabled: rule.isEnabled,
          createdAt: new Date(rule.createdAt),
        },
      });
    }

    // Import transactions
    for (const txn of data.transactions) {
      await tx.transaction.create({
        data: {
          id: txn.id,
          date: new Date(txn.date),
          amount: txn.amount,
          accountId: txn.accountId,
          merchant: txn.merchant,
          merchantNormalized: txn.merchantNormalized,
          categoryId: txn.categoryId,
          tags: txn.tags,
          note: txn.note,
          isTransfer: txn.isTransfer,
          transferGroupId: txn.transferGroupId,
          confidenceScore: txn.confidenceScore,
          externalId: txn.externalId,
          importHash: txn.importHash,
          isOffset: txn.isOffset,
          linkedTransactionId: txn.linkedTransactionId,
          createdAt: new Date(txn.createdAt),
        },
      });
    }

    // Import budgets
    for (const budget of data.budgets) {
      await tx.categoryBudget.create({
        data: {
          id: budget.id,
          month: budget.month,
          categoryId: budget.categoryId,
          limitAmount: budget.limitAmount,
          createdAt: new Date(budget.createdAt),
        },
      });
    }

    // Import monthly snapshots
    for (const snapshot of data.monthlySnapshots) {
      await tx.monthlySnapshot.create({
        data: {
          id: snapshot.id,
          month: snapshot.month,
          incomeTotal: snapshot.incomeTotal,
          spendingTotal: snapshot.spendingTotal,
          savingsTotal: snapshot.savingsTotal,
          savingsRatePct: snapshot.savingsRatePct,
          categoryTotals: snapshot.categoryTotals,
          merchantTotals: snapshot.merchantTotals,
          createdAt: new Date(snapshot.createdAt),
        },
      });
    }

    // Import net worth snapshots
    for (const snapshot of data.netWorthSnapshots) {
      await tx.netWorthSnapshot.create({
        data: {
          id: snapshot.id,
          date: new Date(snapshot.date),
          netWorth: snapshot.netWorth,
          totalAssets: snapshot.totalAssets,
          totalLiabilities: snapshot.totalLiabilities,
          accountBalances: snapshot.accountBalances,
          period: snapshot.period,
          notes: snapshot.notes,
          isAutomatic: snapshot.isAutomatic,
          createdAt: new Date(snapshot.createdAt),
        },
      });
    }

    // Import exchange rates
    for (const rate of data.exchangeRates) {
      await tx.exchangeRate.create({
        data: {
          id: rate.id,
          fromCurrency: rate.fromCurrency,
          toCurrency: rate.toCurrency,
          rate: rate.rate,
          updatedAt: new Date(rate.updatedAt),
          createdAt: new Date(rate.createdAt),
        },
      });
    }

    // Import settings
    if (data.settings) {
      await tx.userSettings.create({
        data: {
          id: data.settings.id,
          baseCurrency: data.settings.baseCurrency,
          updatedAt: new Date(data.settings.updatedAt),
          createdAt: new Date(data.settings.createdAt),
        },
      });
    }
  });
}

/**
 * Get record counts for status display
 */
export async function getRecordCounts(): Promise<SyncMetadata['recordCounts']> {
  const [
    accounts,
    transactions,
    categories,
    rules,
    budgets,
    monthlySnapshots,
    netWorthSnapshots,
    exchangeRates,
  ] = await Promise.all([
    getPrisma().account.count(),
    getPrisma().transaction.count(),
    getPrisma().category.count(),
    getPrisma().rule.count(),
    getPrisma().categoryBudget.count(),
    getPrisma().monthlySnapshot.count(),
    getPrisma().netWorthSnapshot.count(),
    getPrisma().exchangeRate.count(),
  ]);

  return {
    accounts,
    transactions,
    categories,
    rules,
    budgets,
    monthlySnapshots,
    netWorthSnapshots,
    exchangeRates,
  };
}
