'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TellerAccountSelector } from './TellerAccountSelector';
import type { TellerConnect, TellerConnectOptions } from './types';
import './types'; // Import for side-effect (global Window declaration)

type TellerAccount = {
  id: string;
  name: string;
  type: string;
  subtype: string;
  last_four: string;
  status: string;
  institution: {
    id: string;
    name: string;
  };
};

interface TellerConnectButtonProps {
  accountId: string;
  accountName: string;
  onSuccess: (payload: {
    accessToken: string;
    enrollmentId: string;
    tellerAccountId: string;
    institutionName: string;
  }) => void;
  onExit?: () => void;
  className?: string;
}

export function TellerConnectButton({
  accountId,
  accountName,
  onSuccess,
  onExit,
  className,
}: TellerConnectButtonProps) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tellerConnect, setTellerConnect] = useState<TellerConnect | null>(null);
  const [config, setConfig] = useState<{ applicationId: string; environment: string } | null>(null);

  // Account selector state
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState<TellerAccount[]>([]);
  const [pendingPayload, setPendingPayload] = useState<{
    accessToken: string;
    enrollmentId: string;
    institutionName: string;
  } | null>(null);

  // Load Teller Connect script
  useEffect(() => {
    const loadScript = () => {
      // Check if script is already loaded
      if (window.TellerConnect) {
        return Promise.resolve();
      }

      // Check if script tag already exists
      const existingScript = document.querySelector('script[src*="teller.io/connect"]');
      if (existingScript) {
        return new Promise<void>((resolve) => {
          existingScript.addEventListener('load', () => resolve());
          // If already loaded
          if (window.TellerConnect) resolve();
        });
      }

      return new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.teller.io/connect/connect.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Teller Connect'));
        document.head.appendChild(script);
      });
    };

    const init = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch config from our API
        const res = await fetch('/api/teller/config');
        const configData = await res.json();

        if (configData.error) {
          setError(configData.error);
          setLoading(false);
          return;
        }

        setConfig(configData);

        // Load the script
        await loadScript();
        setReady(true);
      } catch (_err) {
        setError('Failed to initialize Teller Connect');
      }

      setLoading(false);
    };

    init();
  }, []);

  // Setup Teller Connect when ready
  useEffect(() => {
    if (!ready || !config || !window.TellerConnect) return;

    const tc = window.TellerConnect.setup({
      applicationId: config.applicationId,
      environment: config.environment as 'sandbox' | 'development' | 'production',
      products: ['transactions'],
      onSuccess: async (payload) => {
        console.log('[TellerConnect] onSuccess called with full payload:', payload);

        try {
          // Fetch accounts from Teller API using the access token
          console.log('[TellerConnect] Fetching accounts from Teller API...');
          const response = await fetch('/api/teller/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken: payload.accessToken,
            }),
          });

          const data = await response.json();
          console.log('[TellerConnect] Accounts response:', data);

          if (data.error) {
            console.error('[TellerConnect] Error fetching accounts:', data.error);
            setError(data.error);
            return;
          }

          if (!data.accounts || data.accounts.length === 0) {
            console.error('[TellerConnect] No accounts found');
            setError('No accounts found');
            return;
          }

          // Store accounts and show selector
          console.log(
            '[TellerConnect] Showing account selector with',
            data.accounts.length,
            'accounts'
          );
          setAvailableAccounts(data.accounts);
          setPendingPayload({
            accessToken: payload.accessToken,
            enrollmentId: payload.enrollment.id,
            institutionName: payload.enrollment.institution.name,
          });
          setShowAccountSelector(true);
        } catch (_err) {
          console.error('[TellerConnect] Exception:', err);
          setError('Failed to fetch accounts');
        }
      },
      ...(onExit && { onExit }),
      onFailure: (err) => {
        console.error('[TellerConnect] onFailure called:', err);
        setError(err.message || 'Connection failed');
      },
    });

    setTellerConnect(tc);
  }, [ready, config, onSuccess, onExit]);

  const handleClick = useCallback(() => {
    if (tellerConnect) {
      tellerConnect.open();
    }
  }, [tellerConnect]);

  const handleAccountSelect = useCallback(
    (tellerAccountId: string) => {
      if (!pendingPayload) return;

      console.log('[TellerConnect] Account selected:', tellerAccountId);
      console.log('[TellerConnect] Calling parent onSuccess handler');

      onSuccess({
        accessToken: pendingPayload.accessToken,
        enrollmentId: pendingPayload.enrollmentId,
        tellerAccountId,
        institutionName: pendingPayload.institutionName,
      });

      // Close selector and reset state
      setShowAccountSelector(false);
      setAvailableAccounts([]);
      setPendingPayload(null);
    },
    [pendingPayload, onSuccess]
  );

  const handleAccountSelectorCancel = useCallback(() => {
    console.log('[TellerConnect] Account selection cancelled');
    setShowAccountSelector(false);
    setAvailableAccounts([]);
    setPendingPayload(null);
  }, []);

  if (error) {
    return (
      <Button disabled className={className}>
        Connection Error
      </Button>
    );
  }

  return (
    <>
      <Button
        className={className}
        disabled={!ready || loading || !tellerConnect}
        onClick={handleClick}
      >
        {loading ? 'Loading...' : 'Connect Bank'}
      </Button>

      <TellerAccountSelector
        accounts={availableAccounts}
        financeOSAccountName={accountName}
        isOpen={showAccountSelector}
        onCancel={handleAccountSelectorCancel}
        onSelect={handleAccountSelect}
      />
    </>
  );
}
