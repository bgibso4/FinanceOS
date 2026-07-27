'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import { PlaidReconnectButton } from '@/components/plaid/PlaidReconnectButton';
import { TellerReconnectButton } from '@/components/teller/TellerReconnectButton';
import { AdoptAccountModal } from './AdoptAccountModal';
import { BankAccountRow } from './BankAccountRow';
import { DiscoveredAccountRow } from './DiscoveredAccountRow';
import type { DiscoveredAccount, InstitutionView, Provider, UpdateResult } from './types';

// Status badge component for enrollment/connection status
function StatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)]">
        Connected
      </span>
    );
  }
  if (status === 'disconnected' || status === 'needs_reauth' || status === 'error') {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-[var(--red)]/15 text-[var(--red)]">
        Needs Reconnection
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-[var(--yellow)]/15 text-[var(--yellow)]">
      {status}
    </span>
  );
}

type IgnoredAccountRecord = {
  id: string;
  provider: Provider;
  institutionId: string;
  externalAccountId: string;
  lastFour: string | null;
  name: string | null;
};

interface InstitutionCardProps {
  view: InstitutionView;
  isExpanded: boolean;
  onToggle: () => void;
  disconnecting: boolean;
  onDisconnect: () => void;
  onRefresh: () => void;
}

export function InstitutionCard({
  view,
  isExpanded,
  onToggle,
  disconnecting,
  onDisconnect,
  onRefresh,
}: InstitutionCardProps) {
  const isTeller = view.provider === 'teller';
  const [adopting, setAdopting] = useState<DiscoveredAccount | null>(null);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [ignoredRecords, setIgnoredRecords] = useState<IgnoredAccountRecord[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UpdateResult | null>(null);

  // Teller only flags the "Authorization expired" note (and only offers Reconnect)
  // for `disconnected`/`needs_reauth`; Plaid's enrollment GET route never persists
  // `disconnected` and instead uses `error`/`needs_reauth` — the two providers'
  // conditions are intentionally kept separate rather than merged into one.
  const showExpiredNote = isTeller
    ? view.status === 'disconnected'
    : view.status === 'error' || view.status === 'needs_reauth';

  const showReconnect = isTeller
    ? view.status === 'disconnected' || view.status === 'needs_reauth'
    : view.status === 'error' || view.status === 'needs_reauth';

  // The enrollment GET returns hidden accounts without their ignore-record id, so
  // matching to a deletable record has to happen client-side using the same
  // externalId-first, institution+lastFour-fallback pairing as isAccountIgnored.
  const findIgnoredRecord = (account: DiscoveredAccount): IgnoredAccountRecord | null => {
    if (!ignoredRecords) return null;
    const byExternalId = ignoredRecords.find(
      (r) => r.provider === view.provider && r.externalAccountId === account.externalId
    );
    if (byExternalId) return byExternalId;
    return (
      ignoredRecords.find(
        (r) =>
          r.provider === view.provider &&
          r.institutionId === view.institutionId &&
          !!r.lastFour &&
          r.lastFour === account.lastFour
      ) ?? null
    );
  };

  const handleToggleHidden = async () => {
    const next = !hiddenExpanded;
    setHiddenExpanded(next);
    if (next && ignoredRecords === null) {
      try {
        const res = await fetch('/api/ignored-accounts');
        const data = await res.json();
        setIgnoredRecords(data.ignored || []);
      } catch (error) {
        console.error('Exception fetching ignored accounts:', error);
        setIgnoredRecords([]);
      }
    }
  };

  const handleRestore = async (account: DiscoveredAccount) => {
    const record = findIgnoredRecord(account);
    if (!record) return;
    setRestoringId(record.id);
    setRestoreError(null);
    try {
      const res = await fetch(`/api/ignored-accounts?id=${record.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) {
        console.error('Failed to restore account:', data.error);
        setRestoreError(data.error);
        return;
      }
      setIgnoredRecords((prev) => prev?.filter((r) => r.id !== record.id) ?? null);
      onRefresh();
    } catch (error) {
      console.error('Exception restoring account:', error);
      setRestoreError('Failed to restore account');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className={`border ${ds.border.default} rounded-lg overflow-hidden`}>
      {/* Header */}
      <div
        className={`${ds.bg.tertiary} p-4 cursor-pointer hover:${ds.bg.hover}`}
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className={`font-semibold ${ds.text.primary}`}>{view.institutionName}</h4>
              {isTeller ? (
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  Teller
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                  Plaid
                </span>
              )}
              <StatusBadge status={view.status} />
              {view.discovered.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                  {view.discovered.length} new{' '}
                  {view.discovered.length === 1 ? 'account' : 'accounts'}
                </span>
              )}
            </div>
            <p className={`text-sm ${ds.text.muted} mt-1`}>
              {view.linked.length} of {view.totalAccountCount} accounts linked
              {showExpiredNote && (
                <span className="text-[var(--red)] ml-2">• Authorization expired</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${ds.text.muted}`}>{isExpanded ? '▼' : '▶'}</span>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className={`p-4 border-t ${ds.border.default}`}>
          {/* Result summary from the most recent Add accounts run */}
          {lastResult && (
            <div
              className={`mb-4 p-3 rounded ${ds.status.success.bg} ${ds.status.success.text} text-sm`}
            >
              <div>
                {lastResult.reconnected} {lastResult.reconnected === 1 ? 'account' : 'accounts'}{' '}
                reconnected
                {' · '}
                {lastResult.discovered.length} new{' '}
                {lastResult.discovered.length === 1 ? 'account' : 'accounts'} found
              </div>
              {lastResult.unmatched.length > 0 && (
                <div className={`mt-2 ${ds.status.warning.text}`}>
                  Could not match:{' '}
                  {lastResult.unmatched
                    .map((u) => `${u.name ?? 'Unknown'}${u.lastFour ? ` (••••${u.lastFour})` : ''}`)
                    .join(', ')}
                  . Do not use the Add button below for these accounts — that creates a second,
                  duplicate account and double-counts its balance and transactions. Link them from
                  the account&apos;s own settings instead.
                </div>
              )}
            </div>
          )}

          {/* New accounts discovered on the provider but not yet tracked */}
          {view.discovered.length > 0 && (
            <div className="mb-4">
              <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>New accounts</h5>
              <div className="space-y-2">
                {view.discovered.map((account) => (
                  <DiscoveredAccountRow
                    key={account.externalId}
                    account={account}
                    institutionId={view.institutionId}
                    provider={view.provider}
                    onAdopt={setAdopting}
                    onChanged={onRefresh}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Linked accounts */}
          <div className="mb-4">
            <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>Bank Accounts</h5>
            {view.linked.length === 0 ? (
              <p className={`text-sm ${ds.text.muted}`}>No accounts found</p>
            ) : (
              <div className="space-y-2">
                {view.linked.map((account) => (
                  <BankAccountRow key={account.connectionId} account={account} />
                ))}
              </div>
            )}
          </div>

          {/* Hidden (ignored) accounts */}
          {view.hidden.length > 0 && (
            <div className="mb-4">
              <button
                className={`text-sm font-semibold ${ds.text.secondary} mb-2 flex items-center gap-1`}
                type="button"
                onClick={handleToggleHidden}
              >
                <span>{hiddenExpanded ? '▼' : '▶'}</span>
                Hidden ({view.hidden.length})
              </button>
              {restoreError && (
                <p className={`text-xs ${ds.status.error.text} mb-2`}>{restoreError}</p>
              )}
              {hiddenExpanded && (
                <div className="space-y-2">
                  {view.hidden.map((account) => {
                    const record = findIgnoredRecord(account);
                    return (
                      <div
                        key={account.externalId}
                        className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${ds.text.primary}`}>
                              {account.name}
                            </span>
                            <span className={`text-xs ${ds.text.muted}`}>
                              •••• {account.lastFour}
                            </span>
                          </div>
                          <Button
                            disabled={!record || restoringId === record.id}
                            variant="ghost"
                            onClick={() => handleRestore(account)}
                          >
                            Restore
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-3 border-t">
            {showReconnect &&
              (isTeller ? (
                <TellerReconnectButton
                  enrollmentId={view.updateTargetId}
                  institutionName={view.institutionName}
                  priorEnrollmentId={view.id}
                  onSuccess={onRefresh}
                />
              ) : (
                <PlaidReconnectButton enrollmentId={view.updateTargetId} onSuccess={onRefresh} />
              ))}
            {isTeller ? (
              <TellerReconnectButton
                enrollmentId={view.updateTargetId}
                institutionName={view.institutionName}
                mode="add-accounts"
                priorEnrollmentId={view.id}
                variant="outline"
                onResult={setLastResult}
                onSuccess={onRefresh}
              />
            ) : (
              <PlaidReconnectButton
                enrollmentId={view.updateTargetId}
                mode="add-accounts"
                onSuccess={onRefresh}
              />
            )}
            <Button disabled={disconnecting} variant="destructive" onClick={onDisconnect}>
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        </div>
      )}

      <AdoptAccountModal
        account={adopting}
        enrollmentId={view.id}
        institutionName={view.institutionName}
        provider={view.provider}
        onAdopted={onRefresh}
        onClose={() => setAdopting(null)}
      />
    </div>
  );
}
