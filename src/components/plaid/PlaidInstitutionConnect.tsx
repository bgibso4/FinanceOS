'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink, PlaidLinkOptions, PlaidLinkOnSuccess } from 'react-plaid-link';
import { Button } from '@/components/ui/button';

interface PlaidInstitutionConnectProps {
  onSuccess: () => void;
  onExit?: () => void;
  className?: string;
  buttonText?: string;
}

export function PlaidInstitutionConnect({
  onSuccess,
  onExit,
  className,
  buttonText,
}: PlaidInstitutionConnectProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const fetchLinkToken = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/plaid/link-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setLinkToken(data.linkToken);
        }
      } catch (_err) {
        setError('Failed to initialize Plaid');
      }
      setLoading(false);
    };

    fetchLinkToken();
  }, []);

  const handleSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken, metadata) => {
      console.log('[PlaidInstitutionConnect] onSuccess called with metadata:', metadata);
      setConnecting(true);

      try {
        // Create enrollment in our database
        console.log('[PlaidInstitutionConnect] Creating enrollment...');
        const response = await fetch('/api/plaid/enrollment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution?.institution_id,
            institutionName: metadata.institution?.name || 'Unknown Bank',
          }),
        });

        const data = await response.json();
        console.log('[PlaidInstitutionConnect] Enrollment response:', data);

        if (data.error) {
          console.error('[PlaidInstitutionConnect] Error creating enrollment:', data.error);
          setError(data.error);
          setConnecting(false);
          return;
        }

        console.log('[PlaidInstitutionConnect] Enrollment created successfully');
        setConnecting(false);
        onSuccess();
      } catch (_err) {
        console.error('[PlaidInstitutionConnect] Exception:', err);
        setError('Failed to create enrollment');
        setConnecting(false);
      }
    },
    [onSuccess]
  );

  const config: PlaidLinkOptions = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: onExit,
  };

  const { open, ready } = usePlaidLink(config);

  if (error) {
    return (
      <Button disabled className={className}>
        Connection Error
      </Button>
    );
  }

  return (
    <Button className={className} disabled={!ready || loading || connecting} onClick={() => open()}>
      {loading ? 'Loading...' : connecting ? 'Connecting...' : buttonText || 'Connect via Plaid'}
    </Button>
  );
}
