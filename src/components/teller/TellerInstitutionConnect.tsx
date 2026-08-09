'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TellerConnect } from './types';
import './types'; // Import for side-effect (global Window declaration)

interface TellerInstitutionConnectProps {
  onSuccess: () => void;
  onExit?: () => void;
  className?: string;
  buttonText?: string;
}

export function TellerInstitutionConnect({
  onSuccess,
  onExit,
  className,
  buttonText,
}: TellerInstitutionConnectProps) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tellerConnect, setTellerConnect] = useState<TellerConnect | null>(null);
  const [config, setConfig] = useState<{ applicationId: string; environment: string } | null>(null);

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
        console.log('[TellerInstitutionConnect] onSuccess called with payload:', payload);

        try {
          // This menu creates a *new* institution connection. If the user picked a bank
          // they already have, creating a second enrollment leaves their existing account
          // links pinned to the old token — the exact mess "Add accounts" avoids by
          // adopting them. We can't infer which enrollment to adopt from here (two logins
          // at one bank are legitimate), so warn and let the user decide.
          const existingRes = await fetch('/api/teller/enrollment');
          const existingData = await existingRes.json();
          const duplicate = (existingData.enrollments ?? []).find(
            (e: { institutionId: string; enrollmentId: string }) =>
              e.institutionId === payload.enrollment.institution.id &&
              e.enrollmentId !== payload.enrollment.id
          );

          if (
            duplicate &&
            !confirm(
              `You already have ${payload.enrollment.institution.name} connected.\n\n` +
                'Adding it again creates a separate connection and will NOT move your ' +
                'existing linked accounts across. To pick up a newly opened account, ' +
                'cancel and use "Add accounts" on the existing card instead.\n\n' +
                'Connect anyway?'
            )
          ) {
            return;
          }

          // Create enrollment in our database
          console.log('[TellerInstitutionConnect] Creating enrollment...');
          const response = await fetch('/api/teller/enrollment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken: payload.accessToken,
              enrollmentId: payload.enrollment.id,
              institutionId: payload.enrollment.institution.id,
              institutionName: payload.enrollment.institution.name,
            }),
          });

          const data = await response.json();
          console.log('[TellerInstitutionConnect] Enrollment response:', data);

          if (data.error) {
            console.error('[TellerInstitutionConnect] Error creating enrollment:', data.error);
            setError(data.error);
            return;
          }

          console.log('[TellerInstitutionConnect] Enrollment created successfully');
          onSuccess();
        } catch (err) {
          console.error('[TellerInstitutionConnect] Exception:', err);
          setError('Failed to create enrollment');
        }
      },
      ...(onExit && { onExit }),
      onFailure: (err) => {
        console.error('[TellerInstitutionConnect] onFailure called:', err);
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

  if (error) {
    return (
      <Button disabled className={className}>
        Connection Error
      </Button>
    );
  }

  return (
    <Button
      className={className}
      disabled={!ready || loading || !tellerConnect}
      onClick={handleClick}
    >
      {loading ? 'Loading...' : buttonText || 'Connect New Institution'}
    </Button>
  );
}
