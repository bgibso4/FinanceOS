'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';
import { useSync } from '@/lib/cloud-sync';

interface SyncConfig {
  syncId: string | null;
  passphraseHash: string | null;
  lastSyncAt: string | null;
  deviceId: string;
  enabled: boolean;
}

interface SyncStatusData {
  enabled: boolean;
  syncId: string | null;
  lastSyncAt: string | null;
  status: 'disabled' | 'synced' | 'syncing' | 'error' | 'offline';
  recordCounts: {
    accounts: number;
    transactions: number;
    categories: number;
    rules: number;
    budgets: number;
  } | null;
}

const STORAGE_KEY = 'financeos-sync-config';
const SESSION_PASSPHRASE_KEY = 'financeos-sync-passphrase';

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

function hasSessionPassphrase(): boolean {
  if (typeof window === 'undefined') return false;
  return !!sessionStorage.getItem(SESSION_PASSPHRASE_KEY);
}

export function SyncSettings() {
  // Use the sync hook to set up event listener and manage passphrase
  const syncHook = useSync();

  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup form state
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);

  // Connect modal state
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectSyncId, setConnectSyncId] = useState('');
  const [connectPassphrase, setConnectPassphrase] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Copied state
  const [copied, setCopied] = useState(false);

  // Passphrase unlock state (for existing sync that needs passphrase)
  const [unlockPassphrase, setUnlockPassphrase] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // Check if session already has passphrase (persists across page refreshes)
  const [isUnlocked, setIsUnlocked] = useState(() => hasSessionPassphrase());

  // Load config and status on mount
  useEffect(() => {
    const loaded = loadConfig();
    setConfig(loaded);
    fetchStatus(loaded?.syncId ?? null);
    // Re-check session passphrase in case it was set after initial render
    setIsUnlocked(hasSessionPassphrase());
  }, []);

  const fetchStatus = async (syncId: string | null) => {
    setIsLoading(true);
    try {
      const url = syncId ? `/api/sync/status?syncId=${syncId}` : '/api/sync/status';
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetup = async () => {
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }

    setIsSettingUp(true);
    setError(null);

    try {
      const response = await fetch('/api/sync/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Setup failed');
      }

      const result = await response.json();

      const newConfig: SyncConfig = {
        syncId: result.syncId,
        passphraseHash: result.passphraseHash,
        lastSyncAt: result.setupAt,
        deviceId: crypto.randomUUID(),
        enabled: true,
      };

      setConfig(newConfig);
      saveConfig(newConfig);
      // Store passphrase in hook for auto-sync
      syncHook.setPassphrase(passphrase);
      setIsUnlocked(true);
      console.warn('[SyncSettings] Setup complete, passphrase stored for auto-sync');
      setPassphrase('');
      await fetchStatus(result.syncId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleConnect = async () => {
    if (!connectSyncId || !connectPassphrase) {
      setConnectError('Both Sync ID and passphrase are required');
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      const response = await fetch('/api/sync/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncId: connectSyncId,
          passphrase: connectPassphrase,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Connection failed');
      }

      const result = await response.json();

      const newConfig: SyncConfig = {
        syncId: connectSyncId,
        passphraseHash: result.passphraseHash,
        lastSyncAt: result.connectedAt,
        deviceId: crypto.randomUUID(),
        enabled: true,
      };

      setConfig(newConfig);
      saveConfig(newConfig);
      // Store passphrase in hook for auto-sync
      syncHook.setPassphrase(connectPassphrase);
      setIsUnlocked(true);
      console.warn('[SyncSettings] Connect complete, passphrase stored for auto-sync');
      setShowConnectModal(false);
      setConnectSyncId('');
      setConnectPassphrase('');
      await fetchStatus(connectSyncId);

      // Reload page to show restored data
      window.location.reload();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassphrase) {
      setUnlockError('Please enter your passphrase');
      return;
    }

    setIsUnlocking(true);
    setUnlockError(null);

    try {
      // Verify passphrase by calling status with it (or a verify endpoint)
      // For now, we'll just trust the user and set the passphrase
      syncHook.setPassphrase(unlockPassphrase);
      setIsUnlocked(true);
      setUnlockPassphrase('');
      console.warn('[SyncSettings] Passphrase unlocked for auto-sync');
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Failed to unlock');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm('Disable cloud sync? Your local data will be preserved.')) {
      return;
    }

    try {
      await fetch('/api/sync/disable', { method: 'POST' });
      setConfig(null);
      saveConfig(null);
      setStatus(null);
      setIsUnlocked(false);
      await fetchStatus(null);
    } catch (err) {
      console.error('Failed to disable sync:', err);
    }
  };

  const copySyncId = () => {
    if (config?.syncId) {
      navigator.clipboard.writeText(config.syncId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className={`text-center ${ds.text.muted}`}>Loading sync status...</div>
        </CardContent>
      </Card>
    );
  }

  // Not configured state
  if (!config?.enabled) {
    return (
      <>
        <Card>
          <CardHeader>
            <div className={`text-sm font-semibold ${ds.text.primary}`}>Cloud Sync</div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Info box */}
            <div className={`p-4 rounded-lg ${ds.bg.secondary} border ${ds.border.default}`}>
              <div className={`font-medium ${ds.text.primary} mb-2`}>
                Back up your data securely to the cloud
              </div>
              <div className={`text-sm ${ds.text.secondary} space-y-1`}>
                <p>Your data is encrypted on your device before upload.</p>
                <p>Only you can read it—not even Cloudflare.</p>
                <p className="mt-2">Once enabled, sync happens automatically.</p>
              </div>
            </div>

            {/* Passphrase input */}
            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-2`}>
                Passphrase
              </label>
              <div className="relative">
                <Input
                  className="pr-16"
                  placeholder="Choose a strong passphrase"
                  type={showPassphrase ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
                <button
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${ds.text.muted} hover:${ds.text.primary}`}
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                >
                  {showPassphrase ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className={`mt-1 text-xs ${ds.text.muted}`}>
                You&apos;ll need this to access your data on other devices.
              </p>
            </div>

            {error && (
              <div className={`p-3 rounded-lg ${ds.status.error.bg} ${ds.status.error.text}`}>
                {error}
              </div>
            )}

            <Button className="w-full" disabled={isSettingUp || !passphrase} onClick={handleSetup}>
              {isSettingUp ? 'Setting up...' : 'Enable Cloud Sync'}
            </Button>

            <div className={`border-t ${ds.border.default} pt-4`}>
              <p className={`text-sm ${ds.text.muted} mb-2`}>Already set up on another device?</p>
              <Button variant="outline" onClick={() => setShowConnectModal(true)}>
                Connect Existing
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Connect Modal */}
        <Modal
          isOpen={showConnectModal}
          title="Connect to Existing Sync"
          onClose={() => {
            setShowConnectModal(false);
            setConnectError(null);
          }}
        >
          <div className="space-y-4">
            <p className={`text-sm ${ds.text.secondary}`}>
              Enter your Sync ID and passphrase from another device.
            </p>

            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-2`}>
                Sync ID
              </label>
              <Input
                placeholder="a1b2c3d4-5678-90ab-cdef-1234567890ab"
                value={connectSyncId}
                onChange={(e) => setConnectSyncId(e.target.value)}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium ${ds.text.secondary} mb-2`}>
                Passphrase
              </label>
              <Input
                placeholder="Your passphrase"
                type="password"
                value={connectPassphrase}
                onChange={(e) => setConnectPassphrase(e.target.value)}
              />
            </div>

            <div className={`p-3 rounded-lg ${ds.status.warning.bg} ${ds.status.warning.text}`}>
              <strong>Warning:</strong> This will replace any local data with your cloud backup.
              Bank connections will need to be re-linked.
            </div>

            {connectError && (
              <div className={`p-3 rounded-lg ${ds.status.error.bg} ${ds.status.error.text}`}>
                {connectError}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowConnectModal(false)}>
                Cancel
              </Button>
              <Button
                disabled={isConnecting || !connectSyncId || !connectPassphrase}
                onClick={handleConnect}
              >
                {isConnecting ? 'Connecting...' : 'Connect & Restore'}
              </Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  // Configured state
  return (
    <Card>
      <CardHeader>
        <div className={`text-sm font-semibold ${ds.text.primary}`}>Cloud Sync</div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Unlock prompt if passphrase not set (only shown in new browser session) */}
        {!isUnlocked && (
          <div
            className={`p-4 rounded-lg ${ds.status.warning.bg} border ${ds.status.warning.border}`}
          >
            <div className={`font-medium ${ds.text.primary} mb-2`}>
              New session — enter passphrase to resume auto-sync
            </div>
            <p className={`text-sm ${ds.text.secondary} mb-3`}>
              For security, your passphrase isn&apos;t saved when you close your browser.
            </p>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="Enter your passphrase"
                type="password"
                value={unlockPassphrase}
                onChange={(e) => setUnlockPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              />
              <Button disabled={isUnlocking || !unlockPassphrase} onClick={handleUnlock}>
                {isUnlocking ? 'Unlocking...' : 'Unlock'}
              </Button>
            </div>
            {unlockError && <p className={`mt-2 text-sm ${ds.status.error.text}`}>{unlockError}</p>}
          </div>
        )}

        {/* Status indicator */}
        <div className={`p-4 rounded-lg ${ds.bg.secondary} border ${ds.border.default}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {!isUnlocked && (
                <>
                  <span className="text-[var(--yellow)]">⚠</span>
                  <span className={`font-medium ${ds.text.primary}`}>Locked</span>
                </>
              )}
              {isUnlocked && status?.status === 'synced' && (
                <>
                  <span className="text-[var(--green)]">✓</span>
                  <span className={`font-medium ${ds.text.primary}`}>Synced</span>
                </>
              )}
              {isUnlocked && status?.status === 'syncing' && (
                <>
                  <span className="animate-spin">↻</span>
                  <span className={`font-medium ${ds.text.primary}`}>Syncing...</span>
                </>
              )}
              {isUnlocked && status?.status === 'error' && (
                <>
                  <span className="text-[var(--red)]">⚠</span>
                  <span className={`font-medium ${ds.text.primary}`}>Sync Error</span>
                </>
              )}
            </div>
            <span className={`text-sm ${ds.text.muted}`}>{formatDate(config?.lastSyncAt)}</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={`text-sm ${ds.text.secondary}`}>Sync ID</span>
              <div className="flex items-center gap-2">
                <code className={`text-xs ${ds.text.muted} font-mono`}>
                  {config?.syncId?.slice(0, 8)}...{config?.syncId?.slice(-4)}
                </code>
                <button
                  className={`text-xs px-2 py-1 rounded ${ds.bg.tertiary} ${ds.text.secondary} hover:${ds.text.primary}`}
                  onClick={copySyncId}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {status?.recordCounts && (
              <div className="flex items-center justify-between">
                <span className={`text-sm ${ds.text.secondary}`}>Records</span>
                <span className={`text-sm ${ds.text.muted}`}>
                  {status.recordCounts.transactions.toLocaleString()} transactions ·{' '}
                  {status.recordCounts.accounts} accounts
                </span>
              </div>
            )}
          </div>
        </div>

        <p className={`text-sm ${ds.text.muted}`}>
          Use your Sync ID and passphrase to connect other devices.
        </p>

        <div className={`border-t ${ds.border.default} pt-4`}>
          <Button variant="destructive" onClick={handleDisable}>
            Disable Cloud Sync
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
