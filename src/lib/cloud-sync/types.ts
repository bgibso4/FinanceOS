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

// ============================================================================
// Sync Payload
// ============================================================================

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
  settings: UserSettingsExportSchema.nullable(),
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
  passphraseHash: string | null;
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

export interface SyncSetupRequest {
  passphrase: string;
}

export interface SyncSetupResponse {
  syncId: string;
  setupAt: string;
}

export interface SyncConnectRequest {
  syncId: string;
  passphrase: string;
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
