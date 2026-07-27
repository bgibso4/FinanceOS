'use client';

import { ds } from '@/lib/design-system';
import type { LinkedAccount } from './types';

export function BankAccountRow({ account }: { account: LinkedAccount }) {
  return (
    <div className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className={`text-sm font-medium ${ds.text.primary}`}>
            {account.bankAccountName || 'Unknown Account'}
          </span>
          <p className={`text-xs ${ds.text.muted} mt-1`}>Linked to: {account.linkedAccountName}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
          Linked
        </span>
      </div>
    </div>
  );
}
