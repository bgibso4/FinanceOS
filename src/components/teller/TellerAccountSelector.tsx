'use client';

import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';

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

interface TellerAccountSelectorProps {
  isOpen: boolean;
  accounts: TellerAccount[];
  onSelect: (accountId: string) => void;
  onCancel: () => void;
  financeOSAccountName: string;
}

export function TellerAccountSelector({
  isOpen,
  accounts,
  onSelect,
  onCancel,
  financeOSAccountName,
}: TellerAccountSelectorProps) {
  const getAccountTypeDisplay = (type: string, subtype: string) => {
    if (type === 'depository') {
      if (subtype === 'checking') return 'Checking';
      if (subtype === 'savings') return 'Savings';
      return 'Depository';
    }
    if (type === 'credit') return 'Credit Card';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const getAccountTypeColor = (type: string) => {
    if (type === 'depository') return 'bg-[var(--accent)]/15 text-[var(--accent)]';
    if (type === 'credit') return 'bg-[var(--accent)]/15 text-[var(--accent)]';
    return 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]';
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} title="Select Bank Account" onClose={onCancel}>
      <div className="space-y-4">
        <p className={`text-sm ${ds.text.secondary}`}>
          Select which bank account to link to{' '}
          <span className="font-semibold">{financeOSAccountName}</span>:
        </p>

        <div className="space-y-2">
          {accounts.map((account) => (
            <button
              key={account.id}
              className={`w-full text-left p-4 rounded-lg border ${ds.border.default} hover:border-[var(--accent)] hover:${ds.bg.hover} transition-colors`}
              onClick={() => onSelect(account.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{account.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${getAccountTypeColor(account.type)}`}
                    >
                      {getAccountTypeDisplay(account.type, account.subtype)}
                    </span>
                  </div>
                  <div className={`text-sm ${ds.text.muted}`}>
                    {account.institution.name} •••• {account.last_four}
                  </div>
                </div>
                <div className={`text-xs ${ds.text.muted}`}>
                  {account.status === 'open' ? '✓ Active' : account.status}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
