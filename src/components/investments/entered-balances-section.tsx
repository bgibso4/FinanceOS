'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BalanceSource } from '@/lib/investments/codes';
import { addDays, isoDay, utcDay } from '@/lib/investments/dates';
import { parseBalanceText } from '@/lib/investments/past-balances';
import { SECTION_CARD, SECTION_HEAD, SECTION_SUB } from './account-drawer';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';
import { fmtMoney } from './format';
import { PastBalancesPaste, type PastBalancesResult } from './past-balances-paste';

/** The section's view of `GET …/balances`; every date is `YYYY-MM-DD`. */
export type EnteredBalancesView = {
  balances: { id: string; date: string; balance: number }[];
  enterBefore: string | null;
  today: string;
};

type BalancesResponse = {
  balances: { id: string; date: string; balance: number }[];
  enterBefore: string | null;
  today: string;
};

type SectionAccount = { id: string; currency: string; balanceSource: BalanceSource };

const toView = (r: BalancesResponse): EnteredBalancesView => ({
  balances: r.balances.map((b) => ({ id: b.id, date: b.date.slice(0, 10), balance: b.balance })),
  enterBefore: r.enterBefore,
  today: r.today,
});

/** The latest day an entry is accepted: the day before the cutoff, else today. */
const lastEnterableDay = (v: EnteredBalancesView) =>
  v.enterBefore ? isoDay(addDays(utcDay(v.enterBefore), -1)) : v.today;

const countText = (n: number) => (n === 0 ? 'none yet' : n === 1 ? '1 entry' : `${n} entries`);

function hintText(source: BalanceSource, enterBefore: string | null): string {
  if (!enterBefore) return 'From your statements. The balance holds until the next entry.';
  const verb = source === BalanceSource.Valuation ? 'valuing' : 'syncing';
  return `For days before ${verb} began on ${enterBefore}, from old statements. Each one is exact on its date.`;
}

function AddBalanceForm({
  account,
  lastDay,
  onAdded,
}: {
  account: SectionAccount;
  lastDay: string;
  onAdded: () => Promise<void>;
}) {
  const [date, setDate] = useState(lastDay);
  useEffect(() => setDate(lastDay), [lastDay]);
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseBalanceText(balance);
    if (amount == null) {
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
      setBalance('');
      await onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form className="grid grid-cols-[1fr_1.2fr_auto] items-end gap-2.5" onSubmit={submit}>
        <div>
          <label className={FIELD_LABEL} htmlFor={`entered-date-${account.id}`}>
            As of
          </label>
          <Input
            className="font-mono"
            id={`entered-date-${account.id}`}
            max={lastDay}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor={`entered-balance-${account.id}`}>
            Balance ({account.currency})
          </label>
          <Input
            className="font-mono"
            id={`entered-balance-${account.id}`}
            inputMode="decimal"
            placeholder="0.00"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
        <Button disabled={saving} type="submit">
          Add
        </Button>
      </form>
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function EnteredBalanceList({
  view,
  currency,
  onDelete,
}: {
  view: EnteredBalancesView;
  currency: string;
  onDelete: (b: EnteredBalancesView['balances'][number]) => void;
}) {
  if (view.balances.length === 0) return <p className={HINT}>No balances entered yet.</p>;
  const td = 'border-t border-[var(--border)] py-[7px] pr-2 text-[12.5px]';
  return (
    <table className="mt-2.5 w-full border-collapse text-[var(--text-primary)]">
      <tbody>
        {view.balances.map((b) => (
          <tr key={b.id}>
            <td className={`${td} font-mono`}>{b.date}</td>
            <td className={`${td} text-right font-mono`}>
              {fmtMoney(b.balance, { cents: true, currency })}
            </td>
            <td className={`${td} w-6 text-right`}>
              <button
                aria-label={`Delete balance ${b.date}`}
                className="text-[var(--text-muted)] hover:text-[var(--red)]"
                type="button"
                onClick={() => onDelete(b)}
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EnteredBalancesSection({
  account,
  onChanged,
}: {
  account: SectionAccount;
  onChanged: () => void;
}) {
  const [view, setView] = useState<EnteredBalancesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [keptCount, setKeptCount] = useState(0);
  const url = `/api/investments/accounts/${account.id}/balances`;

  const load = useCallback(async () => {
    try {
      setView(toView(await sendJson<BalancesResponse>(url, 'GET')));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  /** After any write: refetch, then tell the page. */
  const afterWrite = async () => {
    await load();
    onChanged();
  };

  const remove = async (b: EnteredBalancesView['balances'][number]) => {
    setError(null);
    try {
      await sendJson(`${url}/${b.id}`, 'DELETE');
      await afterWrite();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const pasted = async (result: PastBalancesResult) => {
    setPasting(false);
    setKeptCount(result.skipped.filter((s) => s.reason === 'kept').length);
    await afterWrite();
  };

  return (
    <section className={SECTION_CARD}>
      <h4 className={SECTION_HEAD}>
        Balances you entered
        {view && <span className={SECTION_SUB}>{countText(view.balances.length)}</span>}
      </h4>
      {view && (
        <>
          <AddBalanceForm account={account} lastDay={lastEnterableDay(view)} onAdded={afterWrite} />
          <p className={HINT}>{hintText(account.balanceSource, view.enterBefore)}</p>
          <EnteredBalanceList currency={account.currency} view={view} onDelete={remove} />
          {keptCount > 0 && (
            <p className={HINT}>
              {`${keptCount} not saved: a synced or valued balance is already on that day.`}
            </p>
          )}
          {pasting ? (
            <PastBalancesPaste
              account={account}
              view={view}
              onCancel={() => setPasting(false)}
              onSaved={pasted}
            />
          ) : (
            <button
              className="mt-2.5 text-[12.5px] text-[var(--accent)] hover:underline"
              type="button"
              onClick={() => {
                setKeptCount(0);
                setPasting(true);
              }}
            >
              Paste several from a spreadsheet
            </button>
          )}
        </>
      )}
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
