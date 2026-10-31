'use client';

import { OptionCards } from '@/components/ui/option-cards';
import { BalanceSource } from '@/lib/investments/codes';
import { FIELD_LABEL, HINT } from './editor-kit';
import { SOURCE_LABEL } from './format';

const DESCRIPTIONS: Record<BalanceSource, string> = {
  [BalanceSource.Provider]: 'From your institution through its connection.',
  [BalanceSource.Valuation]: 'The units you hold × daily market prices.',
  [BalanceSource.Manual]: 'You enter the balance from statements.',
};
const ORDER = [BalanceSource.Provider, BalanceSource.Valuation, BalanceSource.Manual];
const LABEL = 'Balance source';

/**
 * A synced account is locked to Synced until it is disconnected. Without a connection Synced
 * is never offered, though a disconnected Synced account still shows it checked.
 */
export function BalanceSourcePicker({
  value,
  canSync,
  onChange,
}: {
  value: BalanceSource;
  canSync: boolean;
  onChange: (s: BalanceSource) => void;
}) {
  const options = ORDER.map((s) => ({
    value: s,
    title: SOURCE_LABEL[s],
    description: DESCRIPTIONS[s],
    disabled: canSync ? s !== BalanceSource.Provider : s === BalanceSource.Provider,
  }));
  return (
    <div>
      <span className={FIELD_LABEL}>{LABEL}</span>
      <OptionCards label={LABEL} options={options} value={value} onChange={onChange} />
      <p className={HINT}>
        {canSync
          ? 'Disconnect to value it or enter balances yourself.'
          : 'Synced needs a connection to this account’s institution.'}
      </p>
    </div>
  );
}
