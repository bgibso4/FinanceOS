'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';

export function RecordBalanceModal({
  account,
  today,
  onClose,
  onSaved,
}: {
  account: { id: string; name: string; institution: string; currency: string };
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(balance.replace(/,/g, ''));
    if (!balance.trim() || !Number.isFinite(amount)) {
      setError('Enter a balance');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/accounts/${account.id}/balances`, 'POST', {
        date,
        balance: amount,
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen title={`Record balance · ${account.name}`} onClose={onClose}>
      <form className="grid grid-cols-[1.2fr_1fr_auto] items-end gap-3" onSubmit={submit}>
        <div>
          <label className={FIELD_LABEL} htmlFor="record-balance-amount">
            Balance ({account.currency})
          </label>
          <Input
            className="font-mono"
            id="record-balance-amount"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="record-balance-date">
            As of
          </label>
          <Input
            className="font-mono"
            id="record-balance-date"
            max={today}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button disabled={saving} type="submit">
          Record
        </Button>
      </form>
      <p className={HINT}>
        From your {account.institution} statement. Shown as the balance until the next entry.
      </p>
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
