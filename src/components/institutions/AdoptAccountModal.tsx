'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ds } from '@/lib/design-system';
import { mapBankAccountType } from '@/lib/bank-account-matching';
import type { DiscoveredAccount, Provider } from './types';

const ACCOUNT_TYPES = [
  'checking',
  'credit',
  'brokerage',
  'retirement',
  'crypto',
  'cash',
  'loan',
  'other',
];

interface AdoptAccountModalProps {
  account: DiscoveredAccount | null;
  provider: Provider;
  enrollmentId: string;
  institutionName: string;
  onClose: () => void;
  onAdopted: () => void;
}

export function AdoptAccountModal({
  account,
  provider,
  enrollmentId,
  institutionName,
  onClose,
  onAdopted,
}: AdoptAccountModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('other');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setType(mapBankAccountType(account.type));
    setError(null);
  }, [account]);

  const handleSubmit = async () => {
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/bank-accounts/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          enrollmentId,
          externalAccountId: account.externalId,
          name,
          type,
          subtype: account.subtype,
          lastFour: account.lastFour,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      onAdopted();
      onClose();
    } catch (_err) {
      setError('Failed to add account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!account} title="Add Account" onClose={onClose}>
      <div className="space-y-4">
        <p className={`text-sm ${ds.text.secondary}`}>
          Track <span className="font-semibold">{account?.name}</span> (••••{account?.lastFour})
          from {institutionName}.
        </p>

        <div>
          <label className={`block text-sm ${ds.text.secondary} mb-1`}>Account name</label>
          <input
            className={`w-full rounded border ${ds.border.default} ${ds.bg.primary} ${ds.text.primary} px-3 py-2 text-sm`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className={`block text-sm ${ds.text.secondary} mb-1`}>Type</label>
          <Select className="w-full" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>

        {error && <p className={`text-sm ${ds.status.error.text}`}>{error}</p>}

        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={saving || !name.trim()} onClick={handleSubmit}>
            {saving ? 'Adding...' : 'Add Account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
