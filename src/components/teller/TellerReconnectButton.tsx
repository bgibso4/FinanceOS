'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TellerConnect, TellerConnectOptions, TellerConnectSuccessPayload } from './types';
import './types'; // Import for side-effect (global Window declaration)
import type { UpdateResult } from '@/components/institutions/types';

interface TellerReconnectButtonProps {
  enrollmentId: string;
  institutionName: string;
  /**
   * Our DB id for the enrollment the user is acting on. Sent to the update route so it
   * adopts exactly this enrollment's connections when Teller mints a new enrollment id,
   * instead of guessing by institution — two logins at one bank would otherwise collide.
   */
  priorEnrollmentId?: string;
  /** 'reconnect' repairs a dead enrollment; 'add-accounts' re-runs Connect on a healthy one. */
  mode?: 'reconnect' | 'add-accounts';
  onSuccess: () => void;
  onResult?: (result: UpdateResult) => void;
  onExit?: () => void;
  className?: string;
  variant?: 'primary' | 'ghost' | 'outline' | 'destructive';
}

export function TellerReconnectButton({
  enrollmentId,
  institutionName: _institutionName,
  priorEnrollmentId,
  mode = 'reconnect',
  onSuccess,
  onResult,
  onExit,
  className,
  variant = 'primary',
}: TellerReconnectButtonProps) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tellerConnect, setTellerConnect] = useState<TellerConnect | null>(null);
  const [config, setConfig] = useState<{ applicationId: string; environment: string } | null>(null);

  // Load Teller Connect script
  useEffect(() => {
    const loadScript = () => {
      if (window.TellerConnect) {
        return Promise.resolve();
      }

      const existingScript = document.querySelector('script[src*="teller.io/connect"]');
      if (existingScript) {
        return new Promise<void>((resolve) => {
          existingScript.addEventListener('load', () => resolve());
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
        const res = await fetch('/api/teller/config');
        const configData = await res.json();

        if (configData.error) {
          setError(configData.error);
          setLoading(false);
          return;
        }

        setConfig(configData);
        await loadScript();
        setReady(true);
      } catch (_err) {
        setError('Failed to initialize Teller Connect');
      }

      setLoading(false);
    };

    init();
  }, []);

  // Setup Teller Connect for re-authentication
  useEffect(() => {
    if (!ready || !config || !window.TellerConnect) return;

    const setupOptions: TellerConnectOptions = {
      applicationId: config.applicationId,
      environment: config.environment as 'sandbox' | 'development' | 'production',
      enrollmentId: enrollmentId, // Pass enrollmentId for re-auth
      products: ['transactions'],
      onSuccess: async (payload: TellerConnectSuccessPayload) => {
        console.log('[TellerReconnect] onSuccess - re-authentication complete');
        setReconnecting(true);

        try {
          // Update the enrollment with the new access token
          const response = await fetch('/api/teller/enrollment/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enrollmentId: payload.enrollment.id,
              accessToken: payload.accessToken,
              ...(priorEnrollmentId ? { priorEnrollmentId } : {}),
            }),
          });

          const data = await response.json();

          if (data.error) {
            console.error('[TellerUpdate] Error updating enrollment:', data.error);
            setError(data.error);
            setReconnecting(false);
            return;
          }

          onResult?.({
            reconnected: data.reconnected ?? 0,
            discovered: data.discovered ?? [],
            unmatched: data.unmatched ?? [],
          });
          onSuccess();
        } catch (err) {
          console.error('[TellerReconnect] Exception:', err);
          setError('Failed to reconnect');
        }

        setReconnecting(false);
      },
      onExit: () => {
        console.log('[TellerReconnect] User exited');
        onExit?.();
      },
      onFailure: (err: { message: string }) => {
        console.error('[TellerReconnect] onFailure:', err);
        setError(err.message || 'Reconnection failed');
      },
    };

    const tc = window.TellerConnect.setup(setupOptions);

    setTellerConnect(tc);
  }, [ready, config, enrollmentId, priorEnrollmentId, mode, onResult, onSuccess, onExit]);

  const handleClick = useCallback(() => {
    if (tellerConnect) {
      tellerConnect.open();
    }
  }, [tellerConnect]);

  if (error) {
    return (
      <Button disabled className={className} variant={variant}>
        Error
      </Button>
    );
  }

  return (
    <Button
      className={className}
      disabled={!ready || loading || !tellerConnect || reconnecting}
      variant={variant}
      onClick={handleClick}
    >
      {loading
        ? 'Loading...'
        : reconnecting
          ? mode === 'add-accounts'
            ? 'Checking...'
            : 'Reconnecting...'
          : mode === 'add-accounts'
            ? 'Add accounts'
            : 'Reconnect'}
    </Button>
  );
}
