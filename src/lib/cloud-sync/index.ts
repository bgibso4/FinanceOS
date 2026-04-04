/**
 * Cloud Sync Module
 *
 * End-to-end encrypted sync for FinanceOS using Cloudflare R2.
 */

// Types
export type {
  SyncPayload,
  SyncData,
  SyncMetadata,
  SyncConfig,
  SyncState,
  SyncStatus,
  SyncSetupRequest,
  SyncSetupResponse,
  SyncConnectRequest,
  SyncConnectResponse,
  SyncStatusResponse,
  SyncDisableResponse,
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

export { validateSyncPayload, isSyncPayload } from './types';

// Encryption
export {
  encrypt,
  decrypt,
  generateEncryptionKey,
  getEncryptionKey,
  EncryptionError,
} from './encryption';

// Database sync
export {
  exportDatabase,
  importDatabase,
  getRecordCounts,
  generateChecksum,
  setPrismaClient,
  resetPrismaClient,
} from './sync';

// R2 client
export {
  uploadBlob,
  downloadBlob,
  getCloudMetadata,
  cloudDataExists,
  isCloudNewer,
  checkWorkerHealth,
  R2ClientError,
} from './r2-client';

// Auto-sync engine
export { getSyncManager, queueSync, isyncEnabled } from './auto-sync';

// React hook
export { useSync, triggerSync } from './use-sync';
