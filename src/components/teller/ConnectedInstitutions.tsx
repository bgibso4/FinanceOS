'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import { TellerInstitutionConnect } from './TellerInstitutionConnect';
import { PlaidLinkButton } from '@/components/plaid/PlaidLinkButton';

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
};

type PlaidConnection = {
  id: string;
  accountId: string;
  institutionName: string | null;
  status: string;
  lastSyncAt: string | null;
  account: {
    id: string;
    name: string;
  };
};

type PlaidInstitution = {
  institutionName: string;
  connections: PlaidConnection[];
};

interface ConnectedInstitutionsProps {
  onRefresh?: () => void;
}

export function ConnectedInstitutions({ onRefresh }: ConnectedInstitutionsProps) {
  const [enrollments, setEnrollments] = useState<TellerEnrollment[]>([]);
  const [plaidInstitutions, setPlaidInstitutions] = useState<PlaidInstitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEnrollment, setExpandedEnrollment] = useState<string | null>(null);
  const [expandedPlaidInstitution, setExpandedPlaidInstitution] = useState<string | null>(null);
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

      // Fetch both Teller and Plaid connections in parallel
      const [tellerRes, plaidRes] = await Promise.all([
        fetch('/api/teller/enrollment'),
        fetch('/api/accounts?includePlaid=true'),
      ]);

      const tellerData = await tellerRes.json();
      const plaidData = await plaidRes.json();

      if (!tellerData.error) {
        setEnrollments(tellerData.enrollments || []);
      }

      // Group Plaid connections by institution
      if (!plaidData.error && plaidData.accounts) {
        const plaidConnections = plaidData.accounts
          .filter((acc: any) => acc.plaidConnection)
          .map((acc: any) => ({
            ...acc.plaidConnection,
            account: { id: acc.id, name: acc.name },
          }));

        // Group by institution name
        const grouped = plaidConnections.reduce((acc: Record<string, PlaidConnection[]>, conn: PlaidConnection) => {
          const key = conn.institutionName || 'Unknown Institution';
          if (!acc[key]) acc[key] = [];
          acc[key].push(conn);
          return acc;
        }, {});

        setPlaidInstitutions(
          Object.entries(grouped).map(([name, connections]) => ({
            institutionName: name,
            connections: connections as PlaidConnection[],
          }))
        );
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

  const handleDisconnect = async (enrollmentId: string, institutionName: string) => {
    if (!confirm(`Disconnect from ${institutionName}? This will remove all linked accounts.`)) {
      return;
    }

    try {
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
      console.error('Exception disconnecting enrollment:', error);
      alert('Failed to disconnect institution');
    }
  };

  const handleConnect = async () => {
    // Refresh enrollments after connection
    setShowConnectMenu(false);
    await fetchEnrollments();
    if (onRefresh) onRefresh();
  };

  const handlePlaidSuccess = async (publicToken: string, metadata: any) => {
    // For institution-level connect, we just record the institution
    // The user will link accounts in the account modal
    setShowConnectMenu(false);
    await fetchEnrollments();
    if (onRefresh) onRefresh();
  };

  const toggleExpanded = (enrollmentId: string) => {
    setExpandedEnrollment(expandedEnrollment === enrollmentId ? null : enrollmentId);
  };

  const togglePlaidExpanded = (institutionName: string) => {
    setExpandedPlaidInstitution(expandedPlaidInstitution === institutionName ? null : institutionName);
  };

  if (loading) {
    return (
      <div className={`${ds.bg.secondary} rounded-lg p-6 border ${ds.border.default}`}>
        <h3 className={`text-lg font-semibold ${ds.text.primary} mb-4`}>Connected Institutions</h3>
        <p className={ds.text.muted}>Loading...</p>
      </div>
    );
  }

  const totalConnections = enrollments.length + plaidInstitutions.length;

  return (
    <div className={`${ds.bg.secondary} rounded-lg p-6 border ${ds.border.default}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-lg font-semibold ${ds.text.primary}`}>Connected Institutions</h3>
        <div className="relative" ref={menuRef}>
          <Button
            onClick={() => setShowConnectMenu(!showConnectMenu)}
          >
            Connect New Institution
          </Button>
          {showConnectMenu && (
            <div className={`absolute right-0 mt-2 w-56 rounded-lg shadow-lg ${ds.bg.primary} border ${ds.border.default} z-50 overflow-hidden`}>
              <div className={`p-2 text-xs font-semibold ${ds.text.muted} uppercase tracking-wide border-b ${ds.border.default}`}>
                Choose Provider
              </div>
              <div className="p-2 space-y-2">
                <div>
                  <TellerInstitutionConnect
                    onSuccess={handleConnect}
                    buttonText="Teller"
                    className="w-full"
                  />
                  <p className={`text-xs ${ds.text.muted} mt-1`}>Best for major US banks</p>
                </div>
                <div>
                  <PlaidLinkButton
                    accountId=""
                    onSuccess={handlePlaidSuccess}
                    buttonText="Plaid"
                    className="w-full"
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
          {enrollments.map((enrollment) => {
            const isExpanded = expandedEnrollment === enrollment.id;
            const linkedCount = enrollment.connections.length;
            const availableCount = enrollment.availableAccounts?.length || 0;

            return (
              <div
                key={enrollment.id}
                className={`border ${ds.border.default} rounded-lg overflow-hidden`}
              >
                {/* Header */}
                <div
                  className={`${ds.bg.tertiary} p-4 cursor-pointer hover:${ds.bg.hover}`}
                  onClick={() => toggleExpanded(enrollment.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-semibold ${ds.text.primary}`}>
                          {enrollment.institutionName}
                        </h4>
                        <span className={`text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400`}>
                          Teller
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200`}>
                          Connected
                        </span>
                      </div>
                      <p className={`text-sm ${ds.text.muted} mt-1`}>
                        {linkedCount} of {availableCount} accounts linked
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${ds.text.muted}`}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className={`p-4 border-t ${ds.border.default}`}>
                    {/* Available Accounts */}
                    <div className="mb-4">
                      <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>
                        Available Accounts
                      </h5>
                      {!enrollment.availableAccounts || enrollment.availableAccounts.length === 0 ? (
                        <p className={`text-sm ${ds.text.muted}`}>No accounts found</p>
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
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t">
                      <Button
                        onClick={() => handleDisconnect(enrollment.id, enrollment.institutionName)}
                        variant="destructive"
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Plaid Institutions */}
          {plaidInstitutions.map((institution) => {
            const isExpanded = expandedPlaidInstitution === institution.institutionName;
            const connectionCount = institution.connections.length;

            return (
              <div
                key={`plaid-${institution.institutionName}`}
                className={`border ${ds.border.default} rounded-lg overflow-hidden`}
              >
                {/* Header */}
                <div
                  className={`${ds.bg.tertiary} p-4 cursor-pointer hover:${ds.bg.hover}`}
                  onClick={() => togglePlaidExpanded(institution.institutionName)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-semibold ${ds.text.primary}`}>
                          {institution.institutionName}
                        </h4>
                        <span className={`text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300`}>
                          Plaid
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200`}>
                          Connected
                        </span>
                      </div>
                      <p className={`text-sm ${ds.text.muted} mt-1`}>
                        {connectionCount} account{connectionCount !== 1 ? 's' : ''} linked
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${ds.text.muted}`}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className={`p-4 border-t ${ds.border.default}`}>
                    <div className="mb-4">
                      <h5 className={`text-sm font-semibold ${ds.text.secondary} mb-2`}>
                        Linked Accounts
                      </h5>
                      <div className="space-y-2">
                        {institution.connections.map((conn) => (
                          <div
                            key={conn.id}
                            className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className={`text-sm font-medium ${ds.text.primary}`}>
                                  {conn.account.name}
                                </span>
                                <p className={`text-xs ${ds.text.muted} mt-1`}>
                                  Status: {conn.status}
                                  {conn.lastSyncAt && ` • Last synced: ${new Date(conn.lastSyncAt).toLocaleDateString()}`}
                                </p>
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                                Linked
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className={`text-xs ${ds.text.muted}`}>
                      To manage individual Plaid connections, go to each account's settings.
                    </p>
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
