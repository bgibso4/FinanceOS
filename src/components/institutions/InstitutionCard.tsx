'use client';

import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import { PlaidReconnectButton } from '@/components/plaid/PlaidReconnectButton';
import { TellerReconnectButton } from '@/components/teller/TellerReconnectButton';
import { BankAccountRow } from './BankAccountRow';
import type { InstitutionView } from './types';

// Status badge component for enrollment/connection status
export function StatusBadge({ status }: { status: string }) {
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
          {/* Bank Accounts */}
          <div className="mb-4">
            <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>Bank Accounts</h5>
            {isTeller ? (
              <>
                {view.discovered.length === 0 ? (
                  view.linked.length === 0 ? (
                    <p className={`text-sm ${ds.text.muted}`}>No accounts found</p>
                  ) : null
                ) : (
                  <div className="space-y-2">
                    {view.discovered.map((account) => {
                      const linkedTo = view.linked.find((l) => l.externalId === account.externalId);
                      const isLinked = Boolean(linkedTo);

                      return (
                        <div
                          key={account.externalId}
                          className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${ds.text.primary}`}>
                                  {account.name}
                                </span>
                                <span className={`text-xs ${ds.text.muted}`}>
                                  •••• {account.lastFour}
                                </span>
                              </div>
                              {isLinked && linkedTo && (
                                <p className={`text-xs ${ds.text.muted} mt-1`}>
                                  Linked to: {linkedTo.linkedAccountName}
                                </p>
                              )}
                            </div>
                            {isLinked && (
                              <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                                Linked
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Show linked accounts if no discovered accounts */}
                {view.discovered.length === 0 && view.linked.length > 0 && (
                  <div className="space-y-2">
                    {view.linked.map((account) => (
                      <BankAccountRow key={account.connectionId} account={account} />
                    ))}
                  </div>
                )}
              </>
            ) : view.discovered.length === 0 && view.linked.length === 0 ? (
              <p className={`text-sm ${ds.text.muted}`}>No accounts found</p>
            ) : (
              <div className="space-y-2">
                {/* Available (unlinked) accounts */}
                {view.discovered.map((account) => (
                  <div
                    key={account.externalId}
                    className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${ds.text.primary}`}>
                            {account.name}
                          </span>
                          <span className={`text-xs ${ds.text.muted}`}>
                            •••• {account.lastFour}
                          </span>
                        </div>
                        <p className={`text-xs ${ds.text.muted} mt-1`}>{account.subtype}</p>
                      </div>
                      <span className={`text-xs ${ds.text.muted}`}>Not linked</span>
                    </div>
                  </div>
                ))}
                {/* Linked accounts */}
                {view.linked.map((account) => (
                  <BankAccountRow key={account.connectionId} account={account} />
                ))}
              </div>
            )}
          </div>

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
            <Button disabled={disconnecting} variant="destructive" onClick={onDisconnect}>
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
