import { PrismaClient } from '@prisma/client';

const keywordCatalog: Record<string, string> = {
  uber: 'Transport',
  lyft: 'Transport',
  safeway: 'Groceries',
  trader: 'Groceries',
  amazon: 'Shopping',
  whole: 'Groceries',
  starbucks: 'Coffee',
  netflix: 'Entertainment',
  spotify: 'Entertainment',
  payroll: 'Income',
  stripe: 'Income',
  venmo: 'Transfer',
  paypal: 'Transfer',
};

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export const normalizeMerchant = (merchant: string): string => {
  let normalized = merchant.toLowerCase();

  // Remove common transaction prefixes
  normalized = normalized.replace(
    /^(pos|purchase|payment|debit|credit|check\s*card|visa|mastercard|amex|discover)\s+/i,
    ''
  );

  // Remove card-level prefixes like "CL *", "SQ *", "TST *", "PP *" (common bank formatting)
  // These are typically 2-3 letters (not common words like UBER, LYFT)
  // Common prefixes: SQ (Square), CL (card level), PP (PayPal), TST (test)
  normalized = normalized.replace(/^(sq|cl|pp|tst|ck|cd)\s*\*\s*/i, '');

  // Remove "paypal" prefix patterns like "PAYPAL *MERCHANT"
  normalized = normalized.replace(/^paypal\s*\*\s*/i, '');

  // Remove transaction codes that follow * or # (like *ABC123XYZ or #RIDE123)
  // These are alphanumeric codes that contain both letters and numbers
  // Pure letter codes like *TRIP or *RIDE are likely part of the merchant name
  normalized = normalized.replace(/[*#](?=[a-z]*\d)[a-z0-9]+/gi, '');

  // Replace standalone * and # with spaces (for patterns like "UBER *TRIP")
  normalized = normalized.replace(/[*#]/g, ' ');

  // Replace remaining special characters with spaces (keep alphanumeric only)
  // This handles -, /, \, etc.
  normalized = normalized.replace(/[*#\-/\\@&+.,'":;!?()[\]{}|<>]/g, ' ');

  // Remove long numeric sequences (likely transaction IDs, reference numbers)
  normalized = normalized.replace(/\b\d{6,}\b/g, '');

  // Remove short transaction codes (2-4 digit codes at start/end)
  normalized = normalized.replace(/^\d{2,4}\s+/g, '');
  normalized = normalized.replace(/\s+\d{2,4}$/g, '');

  // Remove common business suffixes (only at the very end of string)
  // Note: "shop" is only removed as a suffix, not as part of "coffee shop"
  normalized = normalized.replace(/\s+(inc|llc|corp|ltd|co|company|services?)\s*$/gi, '');

  // Remove store/location numbers (e.g., "#1234", "store 567")
  normalized = normalized.replace(/\s*#?\s*\d{3,5}\s*$/g, '');
  normalized = normalized.replace(/\s+store\s*\d+/gi, '');

  // Remove city/state suffixes (common in bank transactions)
  // Pattern: "MERCHANT NAME CITY ST" or "MERCHANT NAME CITY STATE"
  normalized = normalized.replace(
    /\s+[a-z]{2,15}\s+[a-z]{2}$/i,
    '' // Remove "city ST" pattern
  );

  // Normalize multiple spaces to single space and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Take only first 3 meaningful words (helps with long merchant names)
  // Words must be > 2 chars to be meaningful
  const words = normalized.split(' ').filter((w) => w.length > 2);
  normalized = words.slice(0, 3).join(' ');

  // Fallback to original (lowercased, basic cleanup) if empty
  if (!normalized) {
    return merchant
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalized;
};

export async function resolveCategoryId(
  prisma: PrismaClient,
  name: string
): Promise<string | null> {
  const category = await prisma.category.findFirst({
    where: { name: name },
  });
  return category?.id ?? null;
}

export type RuleResult = {
  categoryId: string | null;
  renameTo: string | null;
};

export async function applyRules(
  prisma: PrismaClient,
  merchant: string,
  note: string | null
): Promise<RuleResult> {
  const rules = await prisma.rule.findMany({
    where: { isEnabled: true },
    orderBy: { priority: 'asc' },
  });

  // Collect all matching rules - we may need to combine category from one and rename from another
  let categoryId: string | null = null;
  let renameTo: string | null = null;

  for (const rule of rules) {
    let matches = false;

    if (
      rule.matchType === 'merchantContains' &&
      merchant.toLowerCase().includes(rule.matchValue.toLowerCase())
    ) {
      matches = true;
    } else if (
      rule.matchType === 'noteContains' &&
      note?.toLowerCase().includes(rule.matchValue.toLowerCase())
    ) {
      matches = true;
    } else if (rule.matchType === 'merchantRegex') {
      try {
        const regex = new RegExp(rule.matchValue, 'i');
        if (regex.test(merchant)) matches = true;
      } catch {
        // ignore invalid regex
      }
    }

    if (matches) {
      // Take first matching category
      if (!categoryId && rule.categoryId) {
        categoryId = rule.categoryId;
      }
      // Take first matching rename
      if (!renameTo && rule.renameTo) {
        renameTo = rule.renameTo;
      }
      // If we have both, we're done
      if (categoryId && renameTo) break;
    }
  }

  return { categoryId, renameTo };
}

export type CategorizationResult = {
  categoryId: string | null;
  confidence: number;
  renameTo: string | null;
};

export async function autoCategorize(
  prisma: PrismaClient,
  merchant: string,
  note: string | null
): Promise<CategorizationResult> {
  const ruleResult = await applyRules(prisma, merchant, note);

  // If rule matched with a category, use it
  if (ruleResult.categoryId) {
    return {
      categoryId: ruleResult.categoryId,
      confidence: 0.98,
      renameTo: ruleResult.renameTo,
    };
  }

  // If rule matched with only a rename (no category), still apply the rename
  // but continue looking for a category via keyword catalog
  const normalized = normalizeMerchant(merchant);
  let bestMatch: string | null = null;
  for (const keyword of Object.keys(keywordCatalog)) {
    if (normalized.includes(keyword)) {
      bestMatch = keywordCatalog[keyword];
      break;
    }
  }

  if (bestMatch) {
    const categoryId = await resolveCategoryId(prisma, bestMatch);
    if (categoryId) {
      return {
        categoryId,
        confidence: 0.72,
        renameTo: ruleResult.renameTo,
      };
    }
  }

  return {
    categoryId: null,
    confidence: 0.3,
    renameTo: ruleResult.renameTo,
  };
}
