'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  usePlaidLink,
  PlaidLinkOptions,
  PlaidLinkOnSuccess,
  PlaidLinkOnSuccessMetadata,
} from 'react-plaid-link';
import { Button } from '@/components/ui/button';

interface PlaidLinkButtonProps {
  accountId: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit?: () => void;
  reconnect?: boolean;
  className?: string;
  buttonText?: string;
}

export function PlaidLinkButton({
  accountId,
  onSuccess,
  onExit,
  reconnect = false,
  className,
  buttonText,
}: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLinkToken = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/plaid/link-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: reconnect ? accountId : undefined }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setLinkToken(data.linkToken);
        }
      } catch (err) {
        setError('Failed to initialize bank connection');
      }
      setLoading(false);
    };

    fetchLinkToken();
  }, [accountId, reconnect]);

  const handleSuccess: PlaidLinkOnSuccess = useCallback(
    (publicToken, metadata) => {
      onSuccess(publicToken, metadata);
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

  const defaultText = reconnect ? 'Reconnect Bank' : 'Connect Bank';

  return (
    <Button className={className} disabled={!ready || loading} onClick={() => open()}>
      {loading ? 'Loading...' : buttonText || defaultText}
    </Button>
  );
}
