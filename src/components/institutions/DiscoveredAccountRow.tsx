'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import type { DiscoveredAccount, Provider } from './types';

interface DiscoveredAccountRowProps {
  account: DiscoveredAccount;
  institutionId: string;
  provider: Provider;
  onAdopt: (account: DiscoveredAccount) => void;
  onChanged: () => void;
}

export function DiscoveredAccountRow({
  account,
  institutionId,
  provider,
  onAdopt,
  onChanged,
}: DiscoveredAccountRowProps) {
  const [ignoring, setIgnoring] = useState(false);

  const handleIgnore = async () => {
    setIgnoring(true);
    try {
      const res = await fetch('/api/ignored-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          institutionId,
          externalAccountId: account.externalId,
          lastFour: account.lastFour,
          name: account.name,
        }),
      });
      const data = await res.json();
      if (data.error) {
        console.error('Failed to ignore account:', data.error);
        return;
      }
      onChanged();
    } catch (error) {
      console.error('Exception ignoring account:', error);
    } finally {
      setIgnoring(false);
    }
  };

  return (
    <div className={`p-3 rounded border border-[var(--accent)]/40 ${ds.bg.primary}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${ds.text.primary}`}>{account.name}</span>
            <span className={`text-xs ${ds.text.muted}`}>•••• {account.lastFour}</span>
          </div>
          <p className={`text-xs ${ds.text.muted} mt-1`}>{account.subtype || account.type}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={ignoring} variant="ghost" onClick={handleIgnore}>
            Ignore
          </Button>
          <Button onClick={() => onAdopt(account)}>Add</Button>
        </div>
      </div>
    </div>
  );
}
