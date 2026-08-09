'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ds } from '@/lib/design-system';
import { PlaidInstitutionConnect } from '@/components/plaid/PlaidInstitutionConnect';
import { TellerInstitutionConnect } from '@/components/teller/TellerInstitutionConnect';
import { InstitutionCard } from './InstitutionCard';
import { normalizePlaidEnrollment, normalizeTellerEnrollment } from './normalize';
import type { DiscoveredAccount, InstitutionView } from './types';

type TellerConnection = {
  id: string;
  tellerAccountId: string;
  tellerAccountName: string | null;
  status?: string;
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
  totalAccountCount?: number;
  connections: TellerConnection[];
  availableAccounts?: DiscoveredAccount[];
  hiddenAccounts?: DiscoveredAccount[];
};

type PlaidConnection = {
  id: string;
  plaidAccountId: string;
  plaidAccountName: string | null;
  status?: string;
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
  totalAccountCount?: number;
  connections: PlaidConnection[];
  availableAccounts?: DiscoveredAccount[];
  hiddenAccounts?: DiscoveredAccount[];
};

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
  const [collapsed, setCollapsed] = useState(true);
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

  // `force` bypasses the server-side provider account cache (?refresh=1) — used after
  // an action that can actually change the account list (connect, adopt, disconnect).
  // The initial mount load leaves it off so opening Settings doesn't burn a live
  // provider call every time.
  const fetchEnrollments = async (force = false) => {
    try {
      setLoading(true);

      const query = force ? '?refresh=1' : '';
      // Fetch both Teller and Plaid enrollments in parallel
      const [tellerRes, plaidRes] = await Promise.all([
        fetch(`/api/teller/enrollment${query}`),
        fetch(`/api/plaid/enrollment${query}`),
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

  // Derived (not stored) so a failed fetch of one provider — which leaves that
  // provider's state untouched, see fetchEnrollments above — can't wipe out the
  // other provider's already-loaded institutions.
  const institutions: InstitutionView[] = [
    ...tellerEnrollments.map(normalizeTellerEnrollment),
    ...plaidEnrollments.map(normalizePlaidEnrollment),
  ];

  const handleDisconnect = async (view: InstitutionView) => {
    if (disconnecting) return; // Prevent double-click

    if (
      !confirm(`Disconnect from ${view.institutionName}? This will remove all linked accounts.`)
    ) {
      return;
    }

    const url =
      view.provider === 'teller'
        ? `/api/teller/enrollment?id=${view.id}`
        : `/api/plaid/enrollment?id=${view.id}`;

    try {
      setDisconnecting(view.id);
      const response = await fetch(url, { method: 'DELETE' });

      const data = await response.json();

      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      // Refresh list
      await fetchEnrollments(true);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error(
        `Exception disconnecting ${view.provider === 'teller' ? 'Teller' : 'Plaid'} enrollment:`,
        error
      );
      alert('Failed to disconnect institution');
    } finally {
      setDisconnecting(null);
    }
  };

  const handleConnect = async () => {
    // Refresh enrollments after connection
    setShowConnectMenu(false);
    await fetchEnrollments(true);
    if (onRefresh) onRefresh();
  };

  const handleCardRefresh = () => {
    fetchEnrollments(true);
    if (onRefresh) onRefresh();
  };

  const toggleExpanded = (key: string) => {
    setExpandedEnrollment(expandedEnrollment === key ? null : key);
  };

  const totalConnections = institutions.length;

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <div className="flex items-center gap-3">
          <span
            className={`text-sm ${ds.text.muted} transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <div className={`text-sm font-semibold ${ds.text.primary}`}>Connected Institutions</div>
          {!loading && (
            <span className={`text-xs ${ds.text.muted}`}>
              {totalConnections === 0 ? 'None' : `${totalConnections} connected`}
            </span>
          )}
        </div>
        <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
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
      </CardHeader>

      {collapsed ? null : loading ? (
        <CardContent>
          <p className={ds.text.muted}>Loading...</p>
        </CardContent>
      ) : totalConnections === 0 ? (
        <CardContent>
          <div className={`text-center py-8 ${ds.text.muted}`}>
            <p className="mb-2">No institutions connected yet.</p>
            <p className="text-sm">Connect to a bank to enable automatic transaction imports.</p>
          </div>
        </CardContent>
      ) : (
        <CardContent>
          <div className="space-y-3">
            {institutions.map((view) => (
              <InstitutionCard
                key={view.key}
                disconnecting={disconnecting === view.id}
                isExpanded={expandedEnrollment === view.key}
                view={view}
                onDisconnect={() => handleDisconnect(view)}
                onRefresh={handleCardRefresh}
                onToggle={() => toggleExpanded(view.key)}
              />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
