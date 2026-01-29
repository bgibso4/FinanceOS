/**
 * Auto-Sync Engine
 *
 * Manages automatic synchronization with debouncing, retries, and state management.
 * Uses a singleton pattern to ensure only one sync manager exists.
 */

import { exportDatabase, importDatabase } from './sync';
import { encrypt, decrypt } from './encryption';
import { uploadBlob, downloadBlob, getCloudMetadata, isCloudNewer } from './r2-client';
import type { SyncConfig, SyncState, SyncStatus } from './types';

const DEBOUNCE_MS = 2000; // 2 seconds
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // Exponential backoff

type SyncEventType = 'status-change' | 'sync-complete' | 'sync-error';
type SyncEventListener = (data: { status?: SyncStatus; error?: string }) => void;

class SyncManager {
  private static instance: SyncManager | null = null;

  private config: SyncConfig | null = null;
  private state: SyncState = {
    status: 'disabled',
    lastSyncAt: null,
    lastError: null,
    pendingChanges: 0,
  };

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private isSyncing = false;
  private passphrase: string | null = null;

  private listeners: Map<SyncEventType, Set<SyncEventListener>> = new Map();

  private constructor() {
    // Initialize from localStorage if available
    if (typeof window !== 'undefined') {
      this.loadConfig();
    }
  }

  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  private loadConfig(): void {
    try {
      const stored = localStorage.getItem('financeos-sync-config');
      if (stored) {
        this.config = JSON.parse(stored);
        if (this.config?.enabled && this.config?.syncId) {
          this.state.status = 'synced';
        }
      }
    } catch {
      this.config = null;
    }
  }

  private saveConfig(): void {
    if (typeof window === 'undefined') return;

    if (this.config) {
      localStorage.setItem('financeos-sync-config', JSON.stringify(this.config));
    } else {
      localStorage.removeItem('financeos-sync-config');
    }
  }

  getConfig(): SyncConfig | null {
    return this.config;
  }

  getState(): SyncState {
    return { ...this.state };
  }

  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  getSyncId(): string | null {
    return this.config?.syncId ?? null;
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  on(event: SyncEventType, listener: SyncEventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: SyncEventType, data: { status?: SyncStatus; error?: string }): void {
    this.listeners.get(event)?.forEach((listener) => listener(data));
  }

  private setStatus(status: SyncStatus, error?: string): void {
    this.state.status = status;
    if (error) {
      this.state.lastError = error;
    }
    this.emit('status-change', { status, error });
  }

  // ============================================================================
  // Setup & Connection
  // ============================================================================

  /**
   * Initialize sync for the first time (creates new sync ID)
   */
  async setup(passphrase: string): Promise<string> {
    const syncId = crypto.randomUUID();

    this.passphrase = passphrase;
    this.config = {
      syncId,
      passphraseHash: await this.hashPassphrase(passphrase),
      lastSyncAt: null,
      deviceId: this.getDeviceId(),
      enabled: true,
    };

    this.saveConfig();
    this.setStatus('syncing');

    // Perform initial sync
    await this.syncNow();

    return syncId;
  }

  /**
   * Connect to existing sync (downloads and restores data)
   */
  async connect(syncId: string, passphrase: string): Promise<{ restored: number }> {
    this.setStatus('syncing');

    try {
      // Download and decrypt
      const blob = await downloadBlob(syncId);
      const payload = await decrypt(blob, passphrase);

      // Import into database
      await importDatabase(payload);

      // Save config
      this.passphrase = passphrase;
      this.config = {
        syncId,
        passphraseHash: await this.hashPassphrase(passphrase),
        lastSyncAt: new Date().toISOString(),
        deviceId: this.getDeviceId(),
        enabled: true,
      };

      this.saveConfig();
      this.setStatus('synced');
      this.emit('sync-complete', { status: 'synced' });

      return {
        restored:
          payload.metadata.recordCounts.transactions + payload.metadata.recordCounts.accounts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      this.setStatus('error', message);
      throw error;
    }
  }

  /**
   * Disable sync (keeps local data, stops syncing)
   */
  disable(): void {
    this.config = null;
    this.passphrase = null;
    this.state = {
      status: 'disabled',
      lastSyncAt: null,
      lastError: null,
      pendingChanges: 0,
    };
    this.saveConfig();
    this.emit('status-change', { status: 'disabled' });
  }

  /**
   * Set the passphrase (required for sync operations)
   */
  setPassphrase(passphrase: string): void {
    this.passphrase = passphrase;
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  /**
   * Queue a sync operation (debounced)
   */
  queueSync(): void {
    if (!this.isEnabled() || !this.passphrase) return;

    this.state.pendingChanges++;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.syncNow();
    }, DEBOUNCE_MS);
  }

  /**
   * Force immediate sync
   */
  async syncNow(): Promise<void> {
    if (!this.config?.syncId || !this.passphrase) {
      throw new Error('Sync not configured or passphrase not set');
    }

    if (this.isSyncing) {
      // Already syncing, queue another
      this.state.pendingChanges++;
      return;
    }

    this.isSyncing = true;
    this.setStatus('syncing');

    try {
      // Export database
      const payload = await exportDatabase();

      // Encrypt
      const blob = await encrypt(payload, this.passphrase);

      // Upload
      await uploadBlob(this.config.syncId, blob);

      // Success
      this.config.lastSyncAt = new Date().toISOString();
      this.state.lastSyncAt = this.config.lastSyncAt;
      this.state.pendingChanges = 0;
      this.retryCount = 0;

      this.saveConfig();
      this.setStatus('synced');
      this.emit('sync-complete', { status: 'synced' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      this.state.lastError = message;

      // Retry with exponential backoff
      if (this.retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[this.retryCount];
        this.retryCount++;
        this.setStatus('error', `${message}. Retrying in ${delay / 1000}s...`);

        setTimeout(() => {
          this.isSyncing = false;
          this.syncNow();
        }, delay);
        return;
      }

      this.setStatus('error', message);
      this.emit('sync-error', { error: message });
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Check if cloud has newer data and pull if so
   */
  async checkForUpdates(): Promise<boolean> {
    if (!this.config?.syncId || !this.passphrase) return false;

    try {
      const hasNewer = await isCloudNewer(this.config.syncId, this.config.lastSyncAt);

      if (hasNewer) {
        this.setStatus('syncing');

        const blob = await downloadBlob(this.config.syncId);
        const payload = await decrypt(blob, this.passphrase);
        await importDatabase(payload);

        this.config.lastSyncAt = new Date().toISOString();
        this.state.lastSyncAt = this.config.lastSyncAt;
        this.saveConfig();
        this.setStatus('synced');

        return true;
      }

      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update check failed';
      this.setStatus('error', message);
      return false;
    }
  }

  /**
   * Get cloud metadata for display
   */
  async getCloudInfo(): Promise<{ exists: boolean; lastModified?: string; size?: number } | null> {
    if (!this.config?.syncId) return null;

    try {
      return await getCloudMetadata(this.config.syncId);
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getDeviceId(): string {
    if (typeof window === 'undefined') return crypto.randomUUID();

    const storageKey = 'financeos-device-id';
    let deviceId = localStorage.getItem(storageKey);

    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(storageKey, deviceId);
    }

    return deviceId;
  }

  private async hashPassphrase(passphrase: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`financeos-sync:${passphrase}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

// Export singleton getter
export function getSyncManager(): SyncManager {
  return SyncManager.getInstance();
}

// Convenience exports
export function queueSync(): void {
  getSyncManager().queueSync();
}

export function isyncEnabled(): boolean {
  return getSyncManager().isEnabled();
}
