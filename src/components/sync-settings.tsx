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

export function SyncSettings() {
  const syncHook = useSync();

  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup form state
  const [isSettingUp, setIsSettingUp] = useState(false);

  // Connect modal state
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectSyncId, setConnectSyncId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Copied state
  const [copied, setCopied] = useState(false);

  // Load config and status on mount
  useEffect(() => {
    const loaded = loadConfig();
    setConfig(loaded);
    fetchStatus(loaded?.syncId ?? null);
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
    setIsSettingUp(true);
    setError(null);

    try {
      const response = await fetch('/api/sync/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Setup failed');
      }

      const result = await response.json();

      const newConfig: SyncConfig = {
        syncId: result.syncId,
        lastSyncAt: result.setupAt,
        deviceId: crypto.randomUUID(),
        enabled: true,
      };

      setConfig(newConfig);
      saveConfig(newConfig);
      await fetchStatus(result.syncId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleConnect = async () => {
    if (!connectSyncId) {
      setConnectError('Sync ID is required');
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      const response = await fetch('/api/sync/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncId: connectSyncId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Connection failed');
      }

      const result = await response.json();

      const newConfig: SyncConfig = {
        syncId: connectSyncId,
        lastSyncAt: result.connectedAt,
        deviceId: crypto.randomUUID(),
        enabled: true,
      };

      setConfig(newConfig);
      saveConfig(newConfig);
      setShowConnectModal(false);
      setConnectSyncId('');
      await fetchStatus(connectSyncId);

      // Reload page to show restored data
      window.location.reload();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
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
                <p>Your data is encrypted on the server before upload.</p>
                <p>Encryption is automatic using your server key.</p>
                <p className="mt-2">Once enabled, sync happens automatically.</p>
              </div>
            </div>

            {error && (
              <div className={`p-3 rounded-lg ${ds.status.error.bg} ${ds.status.error.text}`}>
                {error}
              </div>
            )}

            <Button className="w-full" disabled={isSettingUp} onClick={handleSetup}>
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
              Enter the Sync ID from your other device. Make sure both devices have the same
              SYNC_ENCRYPTION_KEY in their .env file.
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
              <Button disabled={isConnecting || !connectSyncId} onClick={handleConnect}>
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
        {/* Status indicator */}
        <div className={`p-4 rounded-lg ${ds.bg.secondary} border ${ds.border.default}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {syncHook.status === 'synced' && (
                <>
                  <span className="text-[var(--green)]">&#10003;</span>
                  <span className={`font-medium ${ds.text.primary}`}>Synced</span>
                </>
              )}
              {syncHook.status === 'syncing' && (
                <>
                  <span className="animate-spin">&#8635;</span>
                  <span className={`font-medium ${ds.text.primary}`}>Syncing...</span>
                </>
              )}
              {syncHook.status === 'error' && (
                <>
                  <span className="text-[var(--red)]">&#9888;</span>
                  <span className={`font-medium ${ds.text.primary}`}>Sync Error</span>
                </>
              )}
              {syncHook.status === 'disabled' && (
                <>
                  <span className={ds.text.muted}>&#9679;</span>
                  <span className={`font-medium ${ds.text.primary}`}>Disabled</span>
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
          To sync to another device, copy your Sync ID and SYNC_ENCRYPTION_KEY from .env.
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
