import { PrismaClient } from '@prisma/client';
import { autoCategorize, normalizeMerchant } from './categorization';
import { detectTransfers as detectTransfersShared } from './sync-common';
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

    const categorization = await autoCategorize(prisma, merchant, note, finalAmount, accountId);

    // Apply merchant rename if rule specifies one
    const finalMerchant = categorization.renameTo || merchant;
    const finalMerchantNormalized = categorization.renameTo
      ? normalizeMerchant(categorization.renameTo)
      : merchantNormalized;

    toInsert.push({
      date,
      amount: finalAmount,
      merchant: finalMerchant,
      merchantNormalized: finalMerchantNormalized,
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

  const transferStats = await detectTransfersShared(accountId, newTransactionIds, prisma);

  return {
    created: created.count,
    ...stats,
    ...transferStats,
  };
}
