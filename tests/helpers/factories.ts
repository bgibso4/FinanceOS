import { v4 as uuid } from 'uuid';

/**
 * Test data factories for creating test fixtures
 * These create plain objects that can be passed to Prisma create methods
 */

export interface AccountData {
  id?: string;
  name: string;
  type: string;
  institution?: string;
  currency?: string;
  isActive?: boolean;
  notes?: string;
}

export function createAccountData(overrides: Partial<AccountData> = {}): AccountData {
  return {
    id: uuid(),
    name: 'Test Account',
    type: 'checking',
    institution: 'Test Bank',
    currency: 'USD',
    isActive: true,
    ...overrides,
  };
}

export interface CategoryData {
  id?: string;
  name: string;
  type: string;
  parentId?: string;
}

export function createCategoryData(overrides: Partial<CategoryData> = {}): CategoryData {
  return {
    id: uuid(),
    name: 'Test Category',
    type: 'expense',
    ...overrides,
  };
}

export interface TransactionData {
  id?: string;
  date: Date;
  amount: number;
  accountId: string;
  merchant: string;
  merchantNormalized?: string;
  categoryId?: string;
  tags?: string;
  note?: string;
  isTransfer?: boolean;
  transferGroupId?: string;
  confidenceScore?: number;
  externalId?: string;
  importHash?: string;
  isOffset?: boolean;
  linkedTransactionId?: string;
}

export function createTransactionData(
  accountId: string,
  overrides: Partial<TransactionData> = {}
): TransactionData {
  const merchant = overrides.merchant || 'Test Merchant';
  return {
    id: uuid(),
    date: new Date(),
    amount: -50.0,
    accountId,
    merchant,
    merchantNormalized: merchant.toLowerCase().trim(),
    tags: '[]',
    confidenceScore: 0.3,
    isTransfer: false,
    isOffset: false,
    ...overrides,
  };
}

export interface RuleData {
  id?: string;
  matchType: string;
  matchValue: string;
  categoryId: string;
  priority?: number;
  isEnabled?: boolean;
}

export function createRuleData(categoryId: string, overrides: Partial<RuleData> = {}): RuleData {
  return {
    id: uuid(),
    matchType: 'merchantContains',
    matchValue: 'test',
    categoryId,
    priority: 100,
    isEnabled: true,
    ...overrides,
  };
}

export interface BudgetData {
  id?: string;
  month: string;
  categoryId: string;
  limitAmount: number;
}

export function createBudgetData(
  categoryId: string,
  overrides: Partial<BudgetData> = {}
): BudgetData {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    id: uuid(),
    month,
    categoryId,
    limitAmount: 500,
    ...overrides,
  };
}

export interface ExchangeRateData {
  id?: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
}

export function createExchangeRateData(
  overrides: Partial<ExchangeRateData> = {}
): ExchangeRateData {
  return {
    id: uuid(),
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    rate: 1.1,
    ...overrides,
  };
}

/**
 * Batch factory helpers for creating multiple related records
 */

export function createTestTransactions(
  accountId: string,
  count: number,
  baseOverrides: Partial<TransactionData> = {}
): TransactionData[] {
  return Array.from({ length: count }, (_, i) =>
    createTransactionData(accountId, {
      ...baseOverrides,
      amount: -(10 + i * 10),
      merchant: `Merchant ${i + 1}`,
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Each day back
    })
  );
}

/**
 * Create a category hierarchy (parent + children)
 */
export function createCategoryHierarchy(
  parentName: string,
  childNames: string[],
  type: string = 'expense'
): { parent: CategoryData; children: CategoryData[] } {
  const parent = createCategoryData({ name: parentName, type });
  const children = childNames.map((name) =>
    createCategoryData({ name, type, parentId: parent.id })
  );
  return { parent, children };
}
