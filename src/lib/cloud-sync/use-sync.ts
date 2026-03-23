'use client';

/**
 * React Hook for Cloud Sync
 *
 * Provides a hook for components to interact with the sync system.
 * Encryption is handled server-side via SYNC_ENCRYPTION_KEY env var,
 * so no passphrase management is needed on the client.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SyncState, SyncStatus } from './types';

interface SyncConfig {
  syncId: string | null;
  lastSyncAt: string | null;
  deviceId: string;
  enabled: boolean;
}

interface UseSyncReturn {
  // State
  isEnabled: boolean;
  status: SyncStatus;
  syncId: string | null;
  lastSyncAt: string | null;
  error: string | null;

  // Actions
  queueSync: () => void;
  setup: () => Promise<string>;
  connect: (syncId: string) => Promise<void>;
  disable: () => void;
}

const STORAGE_KEY = 'financeos-sync-config';
const DEVICE_ID_KEY = 'financeos-device-id';

function getDeviceId(): string {
  if (typeof window === 'undefined') return '';

  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

function loadConfig(): SyncConfig | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveConfig(config: SyncConfig | null): void {
  if (typeof window === 'undefined') return;

  if (config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Debounce timer (module-level to persist across re-renders)
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function useSync(): UseSyncReturn {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [state, setState] = useState<SyncState>({
    status: 'disabled',
    lastSyncAt: null,
    lastError: null,
    pendingChanges: 0,
  });

  // Load config on mount
  useEffect(() => {
    const loaded = loadConfig();
    setConfig(loaded);

    if (loaded?.enabled) {
      setState((s) => ({ ...s, status: 'synced', lastSyncAt: loaded.lastSyncAt }));
    }
  }, []);

  // Queue a sync (debounced)
  const queueSync = useCallback(() => {
    if (!config?.enabled || !config?.syncId) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'syncing' }));

      try {
        const response = await fetch('/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncId: config.syncId }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Sync failed');
        }

        const result = await response.json();

        const updatedConfig = {
          ...config,
          lastSyncAt: result.uploadedAt,
        };
        setConfig(updatedConfig);
        saveConfig(updatedConfig);

        setState((s) => ({
          ...s,
          status: 'synced',
          lastSyncAt: result.uploadedAt,
          lastError: null,
        }));
      } catch (error) {
        console.error('[CloudSync] Sync error:', error);
        setState((s) => ({
          ...s,
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Sync failed',
        }));
      }
    }, 2000); // 2 second debounce
  }, [config]);

  // Listen for sync trigger events from anywhere in the app
  useEffect(() => {
    const handleSyncTrigger = () => {
      queueSync();
    };

    window.addEventListener('financeos-sync-trigger', handleSyncTrigger);
    return () => {
      window.removeEventListener('financeos-sync-trigger', handleSyncTrigger);
    };
  }, [queueSync]);

  // Setup new sync
  const setup = useCallback(async (): Promise<string> => {
    setState((s) => ({ ...s, status: 'syncing' }));

    const response = await fetch('/api/sync/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const error = await response.json();
      setState((s) => ({ ...s, status: 'error', lastError: error.error }));
      throw new Error(error.error || 'Setup failed');
    }

    const result = await response.json();

    const newConfig: SyncConfig = {
      syncId: result.syncId,
      lastSyncAt: result.setupAt,
      deviceId: getDeviceId(),
      enabled: true,
    };

    setConfig(newConfig);
    saveConfig(newConfig);

    setState({
      status: 'synced',
      lastSyncAt: result.setupAt,
      lastError: null,
      pendingChanges: 0,
    });

    return result.syncId;
  }, []);

  // Connect to existing sync
  const connect = useCallback(async (syncId: string): Promise<void> => {
    setState((s) => ({ ...s, status: 'syncing' }));

    const response = await fetch('/api/sync/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncId }),
    });

    if (!response.ok) {
      const error = await response.json();
      setState((s) => ({ ...s, status: 'error', lastError: error.error }));
      throw new Error(error.error || 'Connection failed');
    }

    const result = await response.json();

    const newConfig: SyncConfig = {
      syncId,
      lastSyncAt: result.connectedAt,
      deviceId: getDeviceId(),
      enabled: true,
    };

    setConfig(newConfig);
    saveConfig(newConfig);

    setState({
      status: 'synced',
      lastSyncAt: result.connectedAt,
      lastError: null,
      pendingChanges: 0,
    });
  }, []);

  // Disable sync
  const disable = useCallback(() => {
    fetch('/api/sync/disable', { method: 'POST' }).catch(() => {});

    setConfig(null);
    saveConfig(null);

    setState({
      status: 'disabled',
      lastSyncAt: null,
      lastError: null,
      pendingChanges: 0,
    });
  }, []);

  return {
    isEnabled: config?.enabled ?? false,
    status: state.status,
    syncId: config?.syncId ?? null,
    lastSyncAt: state.lastSyncAt,
    error: state.lastError,
    queueSync,
    setup,
    connect,
    disable,
  };
}

/**
 * Helper to trigger sync from non-React code
 * Call this after any database mutation
 */
export function triggerSync(): void {
  // Dispatch a custom event that the sync hook can listen to
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('financeos-sync-trigger'));
  }
}
