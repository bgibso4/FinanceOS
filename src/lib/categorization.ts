import { PrismaClient } from "@prisma/client";

const keywordCatalog: Record<string, string> = {
  uber: "Transport",
  lyft: "Transport",
  safeway: "Groceries",
  trader: "Groceries",
  amazon: "Shopping",
  whole: "Groceries",
  starbucks: "Coffee",
  netflix: "Entertainment",
  spotify: "Entertainment",
  payroll: "Income",
  stripe: "Income",
  venmo: "Transfer",
  paypal: "Transfer"
};

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export const normalizeMerchant = (merchant: string): string => {
  let normalized = merchant.toLowerCase();
  
  // Remove common prefixes
  normalized = normalized.replace(/^(pos|purchase|payment|debit|credit)\s+/i, '');
  
  // Remove transaction codes (patterns like *AB123CD, #123456, etc)
  normalized = normalized.replace(/[*#]\w+/g, '');
  
  // Remove long numeric sequences (likely transaction IDs)
  normalized = normalized.replace(/\b\d{6,}\b/g, '');
  
  // Remove common suffixes
  normalized = normalized.replace(/\s+(inc|llc|corp|ltd|co|store|shop)\b/gi, '');
  
  // Remove store/location numbers
  normalized = normalized.replace(/\s*#?\s*\d{3,5}\s*$/g, '');
  
  // Remove special characters and extra spaces
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // Take only first 2-3 meaningful words (helps with long merchant names)
  const words = normalized.split(' ').filter(w => w.length > 2);
  normalized = words.slice(0, 3).join(' ');
  
  return normalized || merchant.toLowerCase(); // Fallback to original if empty
};

export async function resolveCategoryId(
  prisma: PrismaClient,
  name: string
): Promise<string | null> {
  const category = await prisma.category.findFirst({
    where: { name: name }
  });
  return category?.id ?? null;
}

export async function applyRules(
  prisma: PrismaClient,
  merchant: string,
  note: string | null
): Promise<string | null> {
  const rules = await prisma.rule.findMany({
    where: { isEnabled: true },
    orderBy: { priority: "asc" }
  });

  for (const rule of rules) {
    if (rule.matchType === "merchantContains" && merchant.toLowerCase().includes(rule.matchValue.toLowerCase())) {
      return rule.categoryId;
    }
    if (rule.matchType === "noteContains" && note?.toLowerCase().includes(rule.matchValue.toLowerCase())) {
      return rule.categoryId;
    }
    if (rule.matchType === "merchantRegex") {
      try {
        const regex = new RegExp(rule.matchValue, "i");
        if (regex.test(merchant)) return rule.categoryId;
      } catch {
        // ignore invalid regex
      }
    }
  }
  return null;
}

export async function autoCategorize(
  prisma: PrismaClient,
  merchant: string,
  note: string | null
): Promise<{ categoryId: string | null; confidence: number }> {
  const ruleCategory = await applyRules(prisma, merchant, note);
  if (ruleCategory) return { categoryId: ruleCategory, confidence: 0.98 };

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
    if (categoryId) return { categoryId, confidence: 0.72 };
  }

  return { categoryId: null, confidence: 0.3 };
}
