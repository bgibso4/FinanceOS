'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

// Teller Connect types
interface TellerConnectEnrollment {
  id: string;
  institution: {
    id: string;
    name: string;
  };
}

interface TellerConnectSuccessPayload {
  accessToken: string;
  enrollment: TellerConnectEnrollment;
}

interface TellerConnectOptions {
  applicationId: string;
  environment?: 'sandbox' | 'development' | 'production';
  products?: string[];
  onSuccess: (payload: TellerConnectSuccessPayload) => void;
  onExit?: () => void;
  onFailure?: (error: { message: string }) => void;
}

interface TellerConnect {
  open: () => void;
}

declare global {
  interface Window {
    TellerConnect?: {
      setup: (options: TellerConnectOptions) => TellerConnect;
    };
  }
}

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
      } catch (err) {
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
