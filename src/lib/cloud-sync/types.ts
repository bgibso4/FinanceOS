/**
 * Cloud Sync Type Definitions
 *
 * Types for sync payloads and configuration.
 * Excludes Plaid/Teller tables (device-local only).
 */

import { z } from 'zod';

// ============================================================================
// Export Types (data that gets synced)
// ============================================================================

export const AccountExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  institution: z.string().nullable(),
  currency: z.string(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  trackingMode: z.string(),
  balanceSource: z.string().nullable().optional(),
  invertAmounts: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(), // ISO 8601
});
export type AccountExport = z.infer<typeof AccountExportSchema>;

export const TransactionExportSchema = z.object({
  id: z.string(),
  date: z.string(), // ISO 8601
  amount: z.number(),
  accountId: z.string(),
  merchant: z.string(),
  merchantNormalized: z.string(),
  categoryId: z.string().nullable(),
  tags: z.string().nullable(),
  note: z.string().nullable(),
  isTransfer: z.boolean(),
  transferGroupId: z.string().nullable(),
  confidenceScore: z.number(),
  externalId: z.string().nullable(),
  importHash: z.string().nullable(),
  isOffset: z.boolean(),
  linkedTransactionId: z.string().nullable(),
  isSplitParent: z.boolean().optional().default(false),
  parentTransactionId: z.string().nullable().optional().default(null),
  createdAt: z.string(), // ISO 8601
});
export type TransactionExport = z.infer<typeof TransactionExportSchema>;

export const CategoryExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  type: z.string(),
  createdAt: z.string(), // ISO 8601
});
export type CategoryExport = z.infer<typeof CategoryExportSchema>;

export const RuleExportSchema = z.object({
  id: z.string(),
  conditions: z.string(),
  categoryId: z.string().nullable(),
  renameTo: z.string().nullable(),
  description: z.string().nullable().optional(),
  priority: z.number(),
  isEnabled: z.boolean(),
  createdAt: z.string(), // ISO 8601
});
export type RuleExport = z.infer<typeof RuleExportSchema>;

export const CategoryBudgetExportSchema = z.object({
  id: z.string(),
  month: z.string(),
  categoryId: z.string(),
  limitAmount: z.number(),
  createdAt: z.string(), // ISO 8601
});
export type CategoryBudgetExport = z.infer<typeof CategoryBudgetExportSchema>;

export const MonthlySnapshotExportSchema = z.object({
  id: z.string(),
  month: z.string(),
  incomeTotal: z.number(),
  spendingTotal: z.number(),
  savingsTotal: z.number(),
  savingsRatePct: z.number(),
  categoryTotals: z.string(), // JSON string
  merchantTotals: z.string(), // JSON string
  createdAt: z.string(), // ISO 8601
});
export type MonthlySnapshotExport = z.infer<typeof MonthlySnapshotExportSchema>;

export const NetWorthSnapshotExportSchema = z.object({
  id: z.string(),
  date: z.string(), // ISO 8601
  netWorth: z.number(),
  totalAssets: z.number(),
  totalLiabilities: z.number(),
  accountBalances: z.string(), // JSON string
  period: z.string().nullable(),
  notes: z.string().nullable(),
  isAutomatic: z.boolean(),
  createdAt: z.string(), // ISO 8601
});
export type NetWorthSnapshotExport = z.infer<typeof NetWorthSnapshotExportSchema>;

export const TagExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(), // ISO 8601
});
export type TagExport = z.infer<typeof TagExportSchema>;

export const GoalExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  targetAmount: z.number(),
  trackingMethod: z.string(),
  categoryId: z.string().nullable(),
  tagId: z.string().nullable(),
  accountId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GoalExport = z.infer<typeof GoalExportSchema>;

export const ExchangeRateExportSchema = z.object({
  id: z.string(),
  fromCurrency: z.string(),
  toCurrency: z.string(),
  rate: z.number(),
  updatedAt: z.string(), // ISO 8601
  createdAt: z.string(), // ISO 8601
});
export type ExchangeRateExport = z.infer<typeof ExchangeRateExportSchema>;

export const UserSettingsExportSchema = z.object({
  id: z.string(),
  baseCurrency: z.string(),
  updatedAt: z.string(), // ISO 8601
  createdAt: z.string(), // ISO 8601
});
export type UserSettingsExport = z.infer<typeof UserSettingsExportSchema>;

export const RecurringTransactionExportSchema = z.object({
  id: z.string(),
  merchantPattern: z.string(),
  merchantDisplay: z.string(),
  accountId: z.string(),
  categoryId: z.string().nullable(),
  frequency: z.string(),
  expectedAmount: z.number(),
  amountVariance: z.number(),
  expectedDayOfMonth: z.number().nullable(),
  medianIntervalDays: z.number(),
  confidence: z.number(),
  intervalRegularity: z.number(),
  amountConsistency: z.number(),
  transactionCount: z.number(),
  firstSeenDate: z.string(), // ISO 8601
  lastSeenDate: z.string(), // ISO 8601
  status: z.string(),
  nextExpectedDate: z.string().nullable(),
  isManualOverride: z.boolean(),
  manuallyCreated: z.boolean(),
  priceHistory: z.string(),
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601
});
export type RecurringTransactionExport = z.infer<typeof RecurringTransactionExportSchema>;

// ============================================================================
// Sync Payload
// ============================================================================

export const AccountBalanceExportSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.string(),
  balance: z.number(),
  currency: z.string(),
  source: z.string(),
  createdAt: z.string(),
});
export const SecurityExportSchema = z.object({
  id: z.string(),
  plaidSecurityId: z.string().nullable(),
  ticker: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  currency: z.string(),
  exchangeMic: z.string().nullable(),
  priceSymbol: z.string().nullable(),
  priceSymbolOverride: z.boolean(),
  pricing: z.string(),
  fixedPrice: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const SecurityPriceExportSchema = z.object({
  id: z.string(),
  securityId: z.string(),
  date: z.string(),
  close: z.number(),
  source: z.string(),
  createdAt: z.string(),
});
export const SecurityEventExportSchema = z.object({
  id: z.string(),
  securityId: z.string(),
  date: z.string(),
  type: z.string(),
  amount: z.number().nullable(),
  ratio: z.number().nullable(),
  source: z.string(),
  createdAt: z.string(),
});
export const HoldingSnapshotExportSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  securityId: z.string(),
  date: z.string(),
  quantity: z.number(),
  price: z.number(),
  value: z.number(),
  costBasis: z.number().nullable(),
  source: z.string(),
  createdAt: z.string(),
});
export const InvestmentTransactionExportSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  securityId: z.string().nullable(),
  externalId: z.string().nullable(),
  date: z.string(),
  type: z.string(),
  subtype: z.string(),
  name: z.string(),
  quantity: z.number().nullable(),
  price: z.number().nullable(),
  amount: z.number(),
  fees: z.number().nullable(),
  currency: z.string(),
  source: z.string(),
  isCancelled: z.boolean(),
  linkedTransactionId: z.string().nullable(),
  createdAt: z.string(),
});

export const SyncDataSchema = z.object({
  accounts: z.array(AccountExportSchema),
  transactions: z.array(TransactionExportSchema),
  categories: z.array(CategoryExportSchema),
  rules: z.array(RuleExportSchema),
  budgets: z.array(CategoryBudgetExportSchema),
  monthlySnapshots: z.array(MonthlySnapshotExportSchema),
  netWorthSnapshots: z.array(NetWorthSnapshotExportSchema),
  exchangeRates: z.array(ExchangeRateExportSchema),
  tags: z.array(TagExportSchema).optional(),
  goals: z.array(GoalExportSchema).optional(),
  recurringTransactions: z.array(RecurringTransactionExportSchema).optional(),
  settings: UserSettingsExportSchema.nullable(),
  // Keep key order identical to exportDatabase: the checksum hashes JSON.stringify(data)
  accountBalances: z.array(AccountBalanceExportSchema).optional(),
  securities: z.array(SecurityExportSchema).optional(),
  securityPrices: z.array(SecurityPriceExportSchema).optional(),
  securityEvents: z.array(SecurityEventExportSchema).optional(),
  holdingSnapshots: z.array(HoldingSnapshotExportSchema).optional(),
  investmentTransactions: z.array(InvestmentTransactionExportSchema).optional(),
});
export type SyncData = z.infer<typeof SyncDataSchema>;

export const SyncMetadataSchema = z.object({
  recordCounts: z.object({
    accounts: z.number(),
    transactions: z.number(),
    categories: z.number(),
    rules: z.number(),
    budgets: z.number(),
    monthlySnapshots: z.number(),
    netWorthSnapshots: z.number(),
    exchangeRates: z.number(),
    tags: z.number().optional(),
    goals: z.number().optional(),
    recurringTransactions: z.number().optional(),
    accountBalances: z.number().optional(),
    securities: z.number().optional(),
    securityPrices: z.number().optional(),
    securityEvents: z.number().optional(),
    holdingSnapshots: z.number().optional(),
    investmentTransactions: z.number().optional(),
  }),
  checksum: z.string(), // SHA-256 of JSON data
});
export type SyncMetadata = z.infer<typeof SyncMetadataSchema>;

export const SyncPayloadSchema = z.object({
  version: z.number(),
  exportedAt: z.string(), // ISO 8601
  deviceId: z.string(),
  data: SyncDataSchema,
  metadata: SyncMetadataSchema,
});
export type SyncPayload = z.infer<typeof SyncPayloadSchema>;

// ============================================================================
// Sync Configuration (stored locally)
// ============================================================================

export interface SyncConfig {
  syncId: string | null;
  lastSyncAt: string | null; // ISO 8601
  deviceId: string;
  enabled: boolean;
}

export type SyncStatus = 'disabled' | 'synced' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingChanges: number;
}

// ============================================================================
// API Types
// ============================================================================

export type SyncSetupRequest = Record<string, never>;

export interface SyncSetupResponse {
  syncId: string;
  setupAt: string;
}

export interface SyncConnectRequest {
  syncId: string;
}

export interface SyncConnectResponse {
  success: boolean;
  connectedAt: string;
  restored: {
    accounts: number;
    transactions: number;
    categories: number;
    rules: number;
    budgets: number;
  };
}

export interface SyncStatusResponse {
  enabled: boolean;
  syncId: string | null;
  lastSyncAt: string | null;
  status: SyncStatus;
  pendingChanges: number;
  recordCounts: SyncMetadata['recordCounts'] | null;
}

export interface SyncDisableResponse {
  success: boolean;
  disabledAt: string;
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateSyncPayload(data: unknown): SyncPayload {
  return SyncPayloadSchema.parse(data);
}

export function isSyncPayload(data: unknown): data is SyncPayload {
  return SyncPayloadSchema.safeParse(data).success;
}
