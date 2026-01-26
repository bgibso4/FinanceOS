'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import { TellerInstitutionConnect } from './TellerInstitutionConnect';
import { TellerReconnectButton } from './TellerReconnectButton';
import { PlaidInstitutionConnect } from '@/components/plaid/PlaidInstitutionConnect';
import { PlaidReconnectButton } from '@/components/plaid/PlaidReconnectButton';

type TellerAccount = {
  id: string;
  name: string;
  type: string;
  subtype: string;
  last_four: string;
  status: string;
};

type TellerConnection = {
  id: string;
  accountId: string;
  tellerAccountId: string;
  tellerAccountName: string | null;
  account: {
    id: string;
    name: string;
  };
};

type TellerEnrollment = {
  id: string;
  enrollmentId: string;
  institutionId: string;
  institutionName: string;
  status: string;
  createdAt: string;
  connections: TellerConnection[];
  availableAccounts?: TellerAccount[];
  totalAccountCount?: number;
};

type PlaidAccount = {
  account_id: string;
  name: string;
  type: string;
  subtype: string;
  mask: string;
};

type PlaidConnection = {
  id: string;
  plaidAccountId: string;
  plaidAccountName: string | null;
  status: string;
  account: {
    id: string;
    name: string;
  };
};

type PlaidEnrollment = {
  id: string;
  plaidItemId: string;
  institutionId: string | null;
  institutionName: string;
  status: string;
  connections: PlaidConnection[];
  availableAccounts?: PlaidAccount[];
};

// Status badge component for enrollment/connection status
function StatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
        Connected
      </span>
    );
  }
  if (status === 'disconnected' || status === 'needs_reauth' || status === 'error') {
    return (
      <span className="text-xs px-2 py-0.5 rounded bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200">
        Needs Reconnection
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">
      {status}
    </span>
  );
}

interface ConnectedInstitutionsProps {
  onRefresh?: () => void;
}

export function ConnectedInstitutions({ onRefresh }: ConnectedInstitutionsProps) {
  const [tellerEnrollments, setTellerEnrollments] = useState<TellerEnrollment[]>([]);
  const [plaidEnrollments, setPlaidEnrollments] = useState<PlaidEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [expandedEnrollment, setExpandedEnrollment] = useState<string | null>(null);
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowConnectMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchEnrollments = async () => {
    try {
      setLoading(true);

      // Fetch both Teller and Plaid enrollments in parallel
      const [tellerRes, plaidRes] = await Promise.all([
        fetch('/api/teller/enrollment'),
        fetch('/api/plaid/enrollment'),
      ]);

      const tellerData = await tellerRes.json();
      const plaidData = await plaidRes.json();

      if (!tellerData.error) {
        setTellerEnrollments(tellerData.enrollments || []);
      }

      if (!plaidData.error) {
        setPlaidEnrollments(plaidData.enrollments || []);
      }
    } catch (error) {
      console.error('Exception fetching enrollments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnrollments();
  }, []);

  const handleTellerDisconnect = async (enrollmentId: string, institutionName: string) => {
    if (disconnecting) return; // Prevent double-click

    if (!confirm(`Disconnect from ${institutionName}? This will remove all linked accounts.`)) {
      return;
    }

    try {
      setDisconnecting(enrollmentId);
      const response = await fetch(`/api/teller/enrollment?id=${enrollmentId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      // Refresh list
      await fetchEnrollments();
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Exception disconnecting Teller enrollment:', error);
      alert('Failed to disconnect institution');
    } finally {
      setDisconnecting(null);
    }
  };

  const handlePlaidDisconnect = async (enrollmentId: string, institutionName: string) => {
    if (disconnecting) return; // Prevent double-click

    if (!confirm(`Disconnect from ${institutionName}? This will remove all linked accounts.`)) {
      return;
    }

    try {
      setDisconnecting(enrollmentId);
      const response = await fetch(`/api/plaid/enrollment?id=${enrollmentId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      // Refresh list
      await fetchEnrollments();
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Exception disconnecting Plaid enrollment:', error);
      alert('Failed to disconnect institution');
    } finally {
      setDisconnecting(null);
    }
  };

  const handleConnect = async () => {
    // Refresh enrollments after connection
    setShowConnectMenu(false);
    await fetchEnrollments();
    if (onRefresh) onRefresh();
  };

  const toggleExpanded = (enrollmentId: string) => {
    setExpandedEnrollment(expandedEnrollment === enrollmentId ? null : enrollmentId);
  };

  if (loading) {
    return (
      <div className={`${ds.bg.secondary} rounded-lg p-6 border ${ds.border.default}`}>
        <h3 className={`text-lg font-semibold ${ds.text.primary} mb-4`}>Connected Institutions</h3>
        <p className={ds.text.muted}>Loading...</p>
      </div>
    );
  }

  const totalConnections = tellerEnrollments.length + plaidEnrollments.length;

  return (
    <div className={`${ds.bg.secondary} rounded-lg p-6 border ${ds.border.default}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-lg font-semibold ${ds.text.primary}`}>Connected Institutions</h3>
        <div ref={menuRef} className="relative">
          <Button onClick={() => setShowConnectMenu(!showConnectMenu)}>
            Connect New Institution
          </Button>
          {showConnectMenu && (
            <div
              className={`absolute right-0 mt-2 w-56 rounded-lg shadow-lg ${ds.bg.primary} border ${ds.border.default} z-50 overflow-hidden`}
            >
              <div
                className={`p-2 text-xs font-semibold ${ds.text.muted} uppercase tracking-wide border-b ${ds.border.default}`}
              >
                Choose Provider
              </div>
              <div className="p-2 space-y-2">
                <div>
                  <TellerInstitutionConnect
                    buttonText="Teller"
                    className="w-full"
                    onSuccess={handleConnect}
                  />
                  <p className={`text-xs ${ds.text.muted} mt-1`}>Best for major US banks</p>
                </div>
                <div>
                  <PlaidInstitutionConnect
                    buttonText="Plaid"
                    className="w-full"
                    onSuccess={handleConnect}
                  />
                  <p className={`text-xs ${ds.text.muted} mt-1`}>Sandbox mode - for testing</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {totalConnections === 0 ? (
        <div className={`text-center py-8 ${ds.text.muted}`}>
          <p className="mb-2">No institutions connected yet.</p>
          <p className="text-sm">Connect to a bank to enable automatic transaction imports.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Teller Enrollments */}
          {tellerEnrollments.map((enrollment) => {
            const isExpanded = expandedEnrollment === `teller-${enrollment.id}`;
            const linkedCount = enrollment.connections.length;
            const totalCount =
              enrollment.totalAccountCount ?? enrollment.availableAccounts?.length ?? 0;

            return (
              <div
                key={`teller-${enrollment.id}`}
                className={`border ${ds.border.default} rounded-lg overflow-hidden`}
              >
                {/* Header */}
                <div
                  className={`${ds.bg.tertiary} p-4 cursor-pointer hover:${ds.bg.hover}`}
                  onClick={() => toggleExpanded(`teller-${enrollment.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-semibold ${ds.text.primary}`}>
                          {enrollment.institutionName}
                        </h4>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          Teller
                        </span>
                        <StatusBadge status={enrollment.status} />
                      </div>
                      <p className={`text-sm ${ds.text.muted} mt-1`}>
                        {linkedCount} of {totalCount} accounts linked
                        {enrollment.status === 'disconnected' && (
                          <span className="text-red-600 dark:text-red-400 ml-2">
                            • Authorization expired
                          </span>
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
                    {/* Available Accounts */}
                    <div className="mb-4">
                      <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>
                        Bank Accounts
                      </h5>
                      {!enrollment.availableAccounts ||
                      enrollment.availableAccounts.length === 0 ? (
                        enrollment.connections.length === 0 ? (
                          <p className={`text-sm ${ds.text.muted}`}>No accounts found</p>
                        ) : null
                      ) : (
                        <div className="space-y-2">
                          {enrollment.availableAccounts.map((account) => {
                            const isLinked = enrollment.connections.some(
                              (conn) => conn.tellerAccountId === account.id
                            );
                            const linkedTo = enrollment.connections.find(
                              (conn) => conn.tellerAccountId === account.id
                            );

                            return (
                              <div
                                key={account.id}
                                className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-medium ${ds.text.primary}`}>
                                        {account.name}
                                      </span>
                                      <span className={`text-xs ${ds.text.muted}`}>
                                        •••• {account.last_four}
                                      </span>
                                    </div>
                                    {isLinked && linkedTo && (
                                      <p className={`text-xs ${ds.text.muted} mt-1`}>
                                        Linked to: {linkedTo.account.name}
                                      </p>
                                    )}
                                  </div>
                                  {isLinked && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                                      Linked
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Show linked accounts if no available accounts */}
                      {(!enrollment.availableAccounts ||
                        enrollment.availableAccounts.length === 0) &&
                        enrollment.connections.length > 0 && (
                          <div className="space-y-2">
                            {enrollment.connections.map((conn) => (
                              <div
                                key={conn.id}
                                className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <span className={`text-sm font-medium ${ds.text.primary}`}>
                                      {conn.tellerAccountName || 'Unknown Account'}
                                    </span>
                                    <p className={`text-xs ${ds.text.muted} mt-1`}>
                                      Linked to: {conn.account.name}
                                    </p>
                                  </div>
                                  <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                                    Linked
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t">
                      {(enrollment.status === 'disconnected' ||
                        enrollment.status === 'needs_reauth') && (
                        <TellerReconnectButton
                          enrollmentId={enrollment.enrollmentId}
                          institutionName={enrollment.institutionName}
                          onSuccess={() => {
                            fetchEnrollments();
                            if (onRefresh) onRefresh();
                          }}
                        />
                      )}
                      <Button
                        disabled={disconnecting === enrollment.id}
                        variant="destructive"
                        onClick={() =>
                          handleTellerDisconnect(enrollment.id, enrollment.institutionName)
                        }
                      >
                        {disconnecting === enrollment.id ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Plaid Enrollments */}
          {plaidEnrollments.map((enrollment) => {
            const isExpanded = expandedEnrollment === `plaid-${enrollment.id}`;
            const linkedCount = enrollment.connections.length;
            const availableCount = enrollment.availableAccounts?.length || 0;

            return (
              <div
                key={`plaid-${enrollment.id}`}
                className={`border ${ds.border.default} rounded-lg overflow-hidden`}
              >
                {/* Header */}
                <div
                  className={`${ds.bg.tertiary} p-4 cursor-pointer hover:${ds.bg.hover}`}
                  onClick={() => toggleExpanded(`plaid-${enrollment.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-semibold ${ds.text.primary}`}>
                          {enrollment.institutionName}
                        </h4>
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300">
                          Plaid
                        </span>
                        <StatusBadge status={enrollment.status} />
                      </div>
                      <p className={`text-sm ${ds.text.muted} mt-1`}>
                        {linkedCount} of {linkedCount + availableCount} accounts linked
                        {(enrollment.status === 'error' ||
                          enrollment.status === 'needs_reauth') && (
                          <span className="text-red-600 dark:text-red-400 ml-2">
                            • Authorization expired
                          </span>
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
                      <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>
                        Bank Accounts
                      </h5>
                      {(!enrollment.availableAccounts ||
                        enrollment.availableAccounts.length === 0) &&
                      enrollment.connections.length === 0 ? (
                        <p className={`text-sm ${ds.text.muted}`}>No accounts found</p>
                      ) : (
                        <div className="space-y-2">
                          {/* Available (unlinked) accounts */}
                          {enrollment.availableAccounts?.map((account) => (
                            <div
                              key={account.account_id}
                              className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm font-medium ${ds.text.primary}`}>
                                      {account.name}
                                    </span>
                                    <span className={`text-xs ${ds.text.muted}`}>
                                      •••• {account.mask}
                                    </span>
                                  </div>
                                  <p className={`text-xs ${ds.text.muted} mt-1`}>
                                    {account.subtype}
                                  </p>
                                </div>
                                <span className={`text-xs ${ds.text.muted}`}>Not linked</span>
                              </div>
                            </div>
                          ))}
                          {/* Linked accounts */}
                          {enrollment.connections.map((conn) => (
                            <div
                              key={conn.id}
                              className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className={`text-sm font-medium ${ds.text.primary}`}>
                                    {conn.plaidAccountName || 'Unknown Account'}
                                  </span>
                                  <p className={`text-xs ${ds.text.muted} mt-1`}>
                                    Linked to: {conn.account.name}
                                  </p>
                                </div>
                                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                                  Linked
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t">
                      {(enrollment.status === 'error' || enrollment.status === 'needs_reauth') && (
                        <PlaidReconnectButton
                          enrollmentId={enrollment.id}
                          onSuccess={() => {
                            fetchEnrollments();
                            if (onRefresh) onRefresh();
                          }}
                        />
                      )}
                      <Button
                        disabled={disconnecting === enrollment.id}
                        variant="destructive"
                        onClick={() =>
                          handlePlaidDisconnect(enrollment.id, enrollment.institutionName)
                        }
                      >
                        {disconnecting === enrollment.id ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
