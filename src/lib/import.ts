import { PrismaClient } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { autoCategorize, normalizeMerchant } from './categorization';
import crypto from 'crypto';

export type CsvMapping = {
  date: string;
  amount: string;
  merchant: string;
  note?: string;
};

type RawRow = Record<string, string>;

function createImportHash(
  accountId: string,
  date: Date,
  amount: number,
  merchantNormalized: string
): string {
  const dateStr = date.toISOString().split('T')[0]; // Just the date part
  const data = `${accountId}|${dateStr}|${amount}|${merchantNormalized}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function csvToJson(csv: string): RawRow[] {
  const rows = csv.trim().split(/\r?\n/);
  const header = rows.shift();
  if (!header) return [];
  const columns = header.split(',').map((c) => c.trim());
  return rows.filter(Boolean).map((line) => {
    const cells = line.split(',');
    const obj: RawRow = {};
    columns.forEach((col, idx) => {
      obj[col] = (cells[idx] ?? '').trim();
    });
    return obj;
  });
}

async function isDuplicate(
  prisma: PrismaClient,
  accountId: string,
  date: Date,
  amount: number,
  merchantNormalized: string,
  externalId?: string,
  importHash?: string
): Promise<boolean> {
  // First check: externalId (most reliable if available)
  if (externalId) {
    const existing = await prisma.transaction.findFirst({
      where: { accountId, externalId },
    });
    if (existing) return true;
  }

  // Second check: importHash (fast and reliable)
  if (importHash) {
    const existing = await prisma.transaction.findFirst({
      where: { importHash },
    });
    if (existing) return true;
  }

  // Third check: normalized merchant match
  const existing = await prisma.transaction.findFirst({
    where: {
      accountId,
      date,
      amount,
      merchantNormalized,
    },
  });
  if (existing) return true;

  return false;
}

export async function importCsv(
  prisma: PrismaClient,
  csv: string,
  mapping: CsvMapping,
  accountId: string,
  invertAmounts: boolean = false
) {
  const parsed = csvToJson(csv);
  const toInsert = [];
  const duplicates: Array<{ merchant: string; amount: number; date: string; reason: string }> = [];

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const rowNum = i + 2; // +2 because: +1 for 1-indexed, +1 for header row

    // Parse date as UTC to avoid timezone issues
    const dateStr = row[mapping.date];
    if (!dateStr) {
      throw new Error(`Row ${rowNum}: Missing date value`);
    }

    // Parse date - handle multiple formats
    let year: number, month: number, day: number;

    const parts = dateStr.split(/[-/]/).map((s) => s.trim());

    if (parts.length !== 3) {
      throw new Error(
        `Row ${rowNum}: Invalid date format "${dateStr}". Expected format: YYYY-MM-DD, MM/DD/YYYY, or MM/DD/YY`
      );
    }

    // Detect format based on first part
    if (parts[0].length === 4) {
      // YYYY-MM-DD format
      [year, month, day] = parts.map(Number);
    } else {
      // MM/DD/YYYY or MM/DD/YY format
      [month, day, year] = parts.map(Number);

      // Handle 2-digit year
      if (year < 100) {
        // Assume 2000s for years 00-99
        year += 2000;
      }
    }

    if (!year || !month || !day || isNaN(year) || isNaN(month) || isNaN(day)) {
      throw new Error(
        `Row ${rowNum}: Invalid date format "${dateStr}". Expected format: YYYY-MM-DD, MM/DD/YYYY, or MM/DD/YY`
      );
    }

    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    if (isNaN(date.getTime())) {
      throw new Error(
        `Row ${rowNum}: Invalid date "${dateStr}" (parsed as ${year}-${month}-${day})`
      );
    }

    // Sanity check: date should be between 2020 and 1 year in the future
    const minDate = new Date(Date.UTC(2020, 0, 1));
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 1);

    if (date < minDate || date > maxDate) {
      throw new Error(
        `Row ${rowNum}: Date "${dateStr}" is outside valid range (2020 to 1 year ahead). Parsed as ${date.toISOString().split('T')[0]}. Check if year format is correct (use 4-digit years or MM/DD/YY format).`
      );
    }

    const amount = Number(row[mapping.amount]);
    if (isNaN(amount)) {
      throw new Error(`Row ${rowNum}: Invalid amount "${row[mapping.amount]}". Must be a number.`);
    }

    // Invert amount if specified (some banks report backwards)
    const finalAmount = invertAmounts ? -amount : amount;

    const merchant = row[mapping.merchant] || 'Unknown';
    const note = mapping.note ? row[mapping.note] : null;

    // Normalize merchant name
    const merchantNormalized = normalizeMerchant(merchant);

    // Create import hash for deduplication
    const importHash = createImportHash(accountId, date, amount, merchantNormalized);

    // Optional: extract externalId if your CSV has it (add to mapping if needed)
    const externalId = undefined; // Could be row[mapping.externalId] if available

    if (
      await isDuplicate(prisma, accountId, date, amount, merchantNormalized, externalId, importHash)
    ) {
      duplicates.push({
        merchant,
        amount: finalAmount,
        date: date.toISOString().split('T')[0],
        reason: 'Already exists in database',
      });
      continue;
    }

    const categorization = await autoCategorize(prisma, merchant, note);
    toInsert.push({
      date,
      amount: finalAmount,
      merchant,
      merchantNormalized,
      note,
      accountId,
      categoryId: categorization.categoryId,
      confidenceScore: categorization.confidence,
      isTransfer: false,
      tags: '[]',
      externalId,
      importHash,
    });
  }

  const created = await prisma.transaction.createMany({ data: toInsert });

  // Get the IDs of newly created transactions
  const newTransactionIds = new Set(
    (
      await prisma.transaction.findMany({
        where: {
          accountId,
          importHash: { in: toInsert.map((t) => t.importHash).filter(Boolean) as string[] },
        },
        select: { id: true },
      })
    ).map((t) => t.id)
  );

  // Collect detailed stats with full transaction info
  const autoCategorized = toInsert.filter((t) => t.categoryId && t.confidenceScore < 1.0);
  const uncategorized = toInsert.filter((t) => !t.categoryId);

  const stats = {
    imported: created.count,
    skipped: parsed.length - toInsert.length,
    duplicates: duplicates,
    autoCategorized: autoCategorized.length,
    autoCategorizedList: autoCategorized.map((t) => ({
      merchant: t.merchant,
      amount: t.amount,
      date: t.date.toISOString().split('T')[0],
      categoryId: t.categoryId,
    })),
    uncategorized: uncategorized.length,
    uncategorizedList: uncategorized.map((t) => ({
      merchant: t.merchant,
      amount: t.amount,
      date: t.date.toISOString().split('T')[0],
    })),
  };

  const transferStats = await detectTransfers(prisma, accountId, newTransactionIds);

  return {
    created: created.count,
    ...stats,
    ...transferStats,
  };
}

async function detectTransfers(
  prisma: PrismaClient,
  accountId: string,
  newTransactionIds: Set<string>
) {
  console.log('🔄 Starting transfer detection for account:', accountId);

  // First: detect same-account transfers (e.g., internal moves)
  // Look at last 90 days to catch all recent transfers
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const recent = await prisma.transaction.findMany({
    where: {
      accountId,
      date: { gte: ninetyDaysAgo },
    },
    orderBy: { date: 'desc' },
  });

  console.log(`  Found ${recent.length} transactions in last 90 days for this account`);

  const byDate: Record<string, typeof recent> = {};
  recent.forEach((tx) => {
    const key = tx.date.toISOString().split('T')[0];
    byDate[key] = byDate[key] ?? [];
    byDate[key].push(tx);
  });

  let sameAccountMatches = 0;
  const sameAccountTransfers: any[] = [];

  for (const group of Object.values(byDate)) {
    for (const tx of group) {
      if (tx.isTransfer) continue;
      const match = group.find(
        (other) =>
          other.id !== tx.id &&
          other.isTransfer === false &&
          Math.abs(Number(other.amount) + Number(tx.amount)) < 0.01
      );
      if (match) {
        const transferGroupId = uuid();
        await prisma.transaction.updateMany({
          where: { id: { in: [tx.id, match.id] } },
          data: { isTransfer: true, transferGroupId },
        });

        // Only report if one of the transactions is newly imported
        if (newTransactionIds.has(tx.id) || newTransactionIds.has(match.id)) {
          sameAccountMatches++;
          sameAccountTransfers.push({
            merchant1: tx.merchant,
            amount1: tx.amount,
            merchant2: match.merchant,
            amount2: match.amount,
            date: tx.date.toISOString().split('T')[0],
          });
          console.log(
            `  ✓ Same-account transfer: ${tx.merchant} $${tx.amount} + ${match.merchant} $${match.amount}`
          );
        }
      }
    }
  }

  console.log(
    `  Found ${sameAccountMatches} same-account transfer pairs involving new transactions`
  );

  // Second: detect cross-account transfers (e.g., credit card payments)
  const { crossAccountMatches, crossAccountTransfers } = await detectCrossAccountTransfers(
    prisma,
    newTransactionIds
  );

  return {
    transfersDetected: sameAccountMatches + crossAccountMatches,
    sameAccount: sameAccountMatches,
    crossAccount: crossAccountMatches,
    sameAccountTransfers,
    crossAccountTransfers,
  };
}

async function detectCrossAccountTransfers(prisma: PrismaClient, newTransactionIds: Set<string>) {
  console.log('🔄 Starting cross-account transfer detection');

  // Get all recent transactions across all accounts (including already-marked transfers)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const allRecent = await prisma.transaction.findMany({
    where: {
      date: { gte: ninetyDaysAgo },
    },
    include: { account: true },
    orderBy: { date: 'desc' },
  });

  console.log(`  Checking ${allRecent.length} transactions across all accounts (last 90 days)`);

  // Log potential transfer candidates
  const candidates = allRecent.filter((tx) => {
    const hasOpposite = allRecent.some(
      (other) =>
        other.id !== tx.id &&
        other.accountId !== tx.accountId &&
        Math.abs(Number(other.amount) + Number(tx.amount)) < 0.01
    );
    return hasOpposite;
  });

  if (candidates.length > 0) {
    console.log(`  Found ${candidates.length} transactions with matching opposite amounts:`);
    candidates.forEach((tx) => {
      console.log(
        `    - ${tx.account.name}: ${tx.merchant} $${tx.amount} on ${tx.date.toISOString().split('T')[0]} (isTransfer: ${tx.isTransfer})`
      );
    });
  }

  // Group by approximate amount (looking for matching positive/negative pairs)
  const processed = new Set<string>();
  let crossAccountMatches = 0;
  const crossAccountTransfers: any[] = [];

  for (const tx of allRecent) {
    if (processed.has(tx.id)) continue;

    // Look for a matching transaction in a different account
    // with opposite sign, within 3 days
    const txDate = tx.date.getTime();
    const threeDays = 3 * 24 * 60 * 60 * 1000;

    const match = allRecent.find((other) => {
      if (other.id === tx.id) return false;
      if (other.accountId === tx.accountId) return false; // Must be different account
      if (processed.has(other.id)) return false;

      // Check if amounts are opposite (one positive, one negative)
      const amountsMatch = Math.abs(Number(other.amount) + Number(tx.amount)) < 0.01;
      if (!amountsMatch) return false;

      // Check if dates are within 3 days
      const otherDate = other.date.getTime();
      const dateDiff = Math.abs(txDate - otherDate);
      if (dateDiff > threeDays) return false;

      // Additional heuristic: check for transfer-like merchant names
      const transferKeywords = [
        'payment',
        'transfer',
        'xfer',
        'autopay',
        'bill pay',
        'credit card',
      ];
      const txMerchant = tx.merchant.toLowerCase();
      const otherMerchant = other.merchant.toLowerCase();
      const hasTransferKeyword = transferKeywords.some(
        (kw) => txMerchant.includes(kw) || otherMerchant.includes(kw)
      );

      // If amounts match exactly and dates are close, it's likely a transfer
      // Boost confidence if merchant names suggest transfer
      return amountsMatch && (dateDiff <= 24 * 60 * 60 * 1000 || hasTransferKeyword);
    });

    if (match) {
      const transferGroupId = uuid();
      // Mark BOTH transactions as transfers, even if one already is
      await prisma.transaction.updateMany({
        where: { id: { in: [tx.id, match.id] } },
        data: { isTransfer: true, transferGroupId },
      });
      processed.add(tx.id);
      processed.add(match.id);

      // Only report if one of the transactions is newly imported
      if (newTransactionIds.has(tx.id) || newTransactionIds.has(match.id)) {
        crossAccountMatches++;
        crossAccountTransfers.push({
          account1: tx.account.name,
          merchant1: tx.merchant,
          amount1: tx.amount,
          account2: match.account.name,
          merchant2: match.merchant,
          amount2: match.amount,
          date: tx.date.toISOString().split('T')[0],
        });
        console.log(
          `  ✓ Cross-account transfer: ${tx.account.name} $${tx.amount} ↔ ${match.account.name} $${match.amount}`
        );
      }
    }
  }

  console.log(
    `  Found ${crossAccountMatches} cross-account transfer pairs involving new transactions`
  );
  console.log('✅ Transfer detection complete');

  return { crossAccountMatches, crossAccountTransfers };
}
