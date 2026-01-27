'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink, PlaidLinkOptions, PlaidLinkOnSuccess } from 'react-plaid-link';
import { Button } from '@/components/ui/button';

interface PlaidReconnectButtonProps {
  enrollmentId: string;
  onSuccess: () => void;
  onExit?: () => void;
  className?: string;
  buttonText?: string;
}

export function PlaidReconnectButton({
  enrollmentId,
  onSuccess,
  onExit,
  className,
  buttonText,
}: PlaidReconnectButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const fetchLinkToken = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch link token in update mode for reconnection
        const res = await fetch('/api/plaid/link-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollmentId }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setLinkToken(data.linkToken);
        }
      } catch (_err) {
        setError('Failed to initialize reconnection');
      }
      setLoading(false);
    };

    fetchLinkToken();
  }, [enrollmentId]);

  const handleSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      console.log('[PlaidReconnectButton] onSuccess called with metadata:', metadata);
      setReconnecting(true);

      try {
        // Update the enrollment with the new credentials
        console.log('[PlaidReconnectButton] Reconnecting enrollment...');
        const response = await fetch('/api/plaid/enrollment/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enrollmentId,
            publicToken,
          }),
        });

        const data = await response.json();
        console.log('[PlaidReconnectButton] Reconnect response:', data);

        if (data.error) {
          console.error('[PlaidReconnectButton] Error reconnecting:', data.error);
          setError(data.error);
          setReconnecting(false);
          return;
        }

        console.log('[PlaidReconnectButton] Reconnected successfully');
        setReconnecting(false);
        onSuccess();
      } catch (err) {
        console.error('[PlaidReconnectButton] Exception:', err);
        setError('Failed to reconnect');
        setReconnecting(false);
      }
    },
    [enrollmentId, onSuccess]
  );

  const config: PlaidLinkOptions = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: onExit,
  };

  const { open, ready } = usePlaidLink(config);

  if (error) {
    return (
      <Button disabled className={className} variant="destructive">
        Reconnect Error
      </Button>
    );
  }

  return (
    <Button
      className={className}
      disabled={!ready || loading || reconnecting}
      variant="outline"
      onClick={() => open()}
    >
      {loading ? 'Loading...' : reconnecting ? 'Reconnecting...' : buttonText || 'Reconnect'}
    </Button>
  );
}
