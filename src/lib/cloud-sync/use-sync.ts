'use client';

/**
 * React Hook for Cloud Sync
 *
 * Provides a hook for components to interact with the sync system
 * and trigger syncs after mutations.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SyncState, SyncStatus } from './types';

interface SyncConfig {
  syncId: string | null;
  passphraseHash: string | null;
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
  setup: (passphrase: string) => Promise<string>;
  connect: (syncId: string, passphrase: string) => Promise<void>;
  disable: () => void;
  setPassphrase: (passphrase: string) => void;
}

const STORAGE_KEY = 'financeos-sync-config';
const DEVICE_ID_KEY = 'financeos-device-id';
const SESSION_PASSPHRASE_KEY = 'financeos-sync-passphrase';

// Store passphrase in sessionStorage (persists across page refreshes, cleared when browser closes)
function storeSessionPassphrase(passphrase: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(SESSION_PASSPHRASE_KEY, passphrase);
  }
}

function getSessionPassphrase(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SESSION_PASSPHRASE_KEY);
}

function clearSessionPassphrase(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_PASSPHRASE_KEY);
  }
}

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
let pendingPassphrase: string | null = null;

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
    const sessionPassphrase = getSessionPassphrase();

    console.warn('[CloudSync] Config loaded on mount:', {
      enabled: loaded?.enabled,
      hasSyncId: !!loaded?.syncId,
      hasSessionPassphrase: !!sessionPassphrase,
    });

    setConfig(loaded);

    if (loaded?.enabled) {
      if (sessionPassphrase) {
        pendingPassphrase = sessionPassphrase;
        console.warn('[CloudSync] Passphrase restored from session, auto-sync ready');
      } else {
        console.warn('[CloudSync] Sync enabled but no session passphrase (new browser session)');
      }
      setState((s) => ({ ...s, status: 'synced', lastSyncAt: loaded.lastSyncAt }));
    }
  }, []);

  // Set passphrase for sync operations
  const setPassphrase = useCallback((passphrase: string) => {
    console.warn('[CloudSync] setPassphrase() called, storing in session');
    pendingPassphrase = passphrase;
    storeSessionPassphrase(passphrase);
  }, []);

  // Queue a sync (debounced)
  const queueSync = useCallback(() => {
    console.warn('[CloudSync] queueSync() called', {
      configEnabled: config?.enabled,
      hasSyncId: !!config?.syncId,
      hasPassphrase: !!pendingPassphrase,
    });

    if (!config?.enabled || !config?.syncId || !pendingPassphrase) {
      console.warn('[CloudSync] queueSync() skipped - missing requirements', {
        enabled: config?.enabled,
        syncId: config?.syncId,
        passphrase: pendingPassphrase ? '[set]' : '[not set]',
      });
      return;
    }

    if (debounceTimer) {
      console.warn('[CloudSync] Clearing existing debounce timer');
      clearTimeout(debounceTimer);
    }

    console.warn('[CloudSync] Setting 2s debounce timer for sync');
    debounceTimer = setTimeout(async () => {
      console.warn('[CloudSync] Debounce complete, starting sync...');
      setState((s) => ({ ...s, status: 'syncing' }));

      try {
        console.warn('[CloudSync] Calling /api/sync/push...');
        const response = await fetch('/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            syncId: config.syncId,
            passphrase: pendingPassphrase,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          console.error('[CloudSync] Push failed:', error);
          throw new Error(error.error || 'Sync failed');
        }

        const result = await response.json();
        console.warn('[CloudSync] Push successful!', result);

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
      console.warn('[CloudSync] Event received, calling queueSync()');
      queueSync();
    };

    console.warn('[CloudSync] Setting up event listener for financeos-sync-trigger');
    window.addEventListener('financeos-sync-trigger', handleSyncTrigger);
    return () => {
      console.warn('[CloudSync] Removing event listener');
      window.removeEventListener('financeos-sync-trigger', handleSyncTrigger);
    };
  }, [queueSync]);

  // Setup new sync
  const setup = useCallback(async (passphrase: string): Promise<string> => {
    setState((s) => ({ ...s, status: 'syncing' }));

    const response = await fetch('/api/sync/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });

    if (!response.ok) {
      const error = await response.json();
      setState((s) => ({ ...s, status: 'error', lastError: error.error }));
      throw new Error(error.error || 'Setup failed');
    }

    const result = await response.json();

    const newConfig: SyncConfig = {
      syncId: result.syncId,
      passphraseHash: result.passphraseHash,
      lastSyncAt: result.setupAt,
      deviceId: getDeviceId(),
      enabled: true,
    };

    setConfig(newConfig);
    saveConfig(newConfig);
    pendingPassphrase = passphrase;
    storeSessionPassphrase(passphrase);
    console.warn('[CloudSync] Setup complete, passphrase stored in session for auto-sync');

    setState({
      status: 'synced',
      lastSyncAt: result.setupAt,
      lastError: null,
      pendingChanges: 0,
    });

    return result.syncId;
  }, []);

  // Connect to existing sync
  const connect = useCallback(async (syncId: string, passphrase: string): Promise<void> => {
    setState((s) => ({ ...s, status: 'syncing' }));

    const response = await fetch('/api/sync/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncId, passphrase }),
    });

    if (!response.ok) {
      const error = await response.json();
      setState((s) => ({ ...s, status: 'error', lastError: error.error }));
      throw new Error(error.error || 'Connection failed');
    }

    const result = await response.json();

    const newConfig: SyncConfig = {
      syncId,
      passphraseHash: result.passphraseHash,
      lastSyncAt: result.connectedAt,
      deviceId: getDeviceId(),
      enabled: true,
    };

    setConfig(newConfig);
    saveConfig(newConfig);
    pendingPassphrase = passphrase;
    storeSessionPassphrase(passphrase);
    console.warn('[CloudSync] Connect complete, passphrase stored in session for auto-sync');

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
    pendingPassphrase = null;
    clearSessionPassphrase();

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
    setPassphrase,
  };
}

/**
 * Helper to trigger sync from non-React code
 * Call this after any database mutation
 */
export function triggerSync(): void {
  // Dispatch a custom event that the sync hook can listen to
  if (typeof window !== 'undefined') {
    console.warn('[CloudSync] triggerSync() called, dispatching event');
    window.dispatchEvent(new CustomEvent('financeos-sync-trigger'));
  }
}
