'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { BalanceSource } from '@/lib/investments/codes';
import {
  classifyPastBalances,
  parsePastBalances,
  type ClassifiedLine,
} from '@/lib/investments/past-balances';
import type { EnteredBalancesView } from './entered-balances-section';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';
import { SOURCE_LABEL, fmtMoney } from './format';

export type PastBalancesResult = { saved: number; skipped: { date: string; reason: string }[] };

type Tag = { text: string; tone: string };

function tagOf(c: ClassifiedLine, currency: string): Tag {
  const s = c.status;
  switch (s.kind) {
    case 'new':
      return { text: 'New', tone: 'text-[var(--green)]' };
    case 'replaces':
      return {
        text: `Replaces ${fmtMoney(s.previous, { cents: true, currency })}`,
        tone: 'text-[var(--accent)]',
      };
    case 'already':
      return { text: 'Already entered', tone: 'text-[var(--text-muted)]' };
    case 'skipped':
      return {
        text: `Skipped: ${SOURCE_LABEL[s.source].toLowerCase()} from ${s.from}`,
        tone: 'text-[var(--text-muted)]',
      };
    case 'future':
      return { text: 'In the future', tone: 'text-[var(--text-muted)]' };
    case 'repeated':
      return { text: 'Date repeated', tone: 'text-[var(--text-muted)]' };
    case 'unreadable':
      return { text: 'Can’t read this line', tone: 'text-[var(--red)]' };
  }
}

export function PastBalancesPaste({
  account,
  view,
  onCancel,
  onSaved,
}: {
  account: { id: string; currency: string; balanceSource: BalanceSource };
  view: EnteredBalancesView;
  onCancel: () => void;
  onSaved: (result: PastBalancesResult) => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { balances, enterBefore, today } = view;
  const source = account.balanceSource;

  const lines = useMemo(
    () =>
      classifyPastBalances(parsePastBalances(text), {
        entered: balances,
        enterBefore,
        source,
        today,
      }),
    [text, balances, enterBefore, source, today]
  );
  const savable = lines.filter((l) => l.saves);
  const toSave = savable.length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        balances: savable.flatMap((l) =>
          l.line.kind === 'ok' ? [{ date: l.line.date, balance: l.line.balance }] : []
        ),
      };
      const result = await sendJson<PastBalancesResult>(
        `/api/investments/accounts/${account.id}/balances`,
        'POST',
        body
      );
      onSaved(result);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  const td = 'border-t border-[var(--border)] py-[6px] pr-2 text-[12.5px]';
  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
      <label className={FIELD_LABEL} htmlFor={`paste-balances-${account.id}`}>
        Paste past balances
      </label>
      <textarea
        className="h-28 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-2 font-mono text-[12.5px] text-[var(--text-primary)]"
        id={`paste-balances-${account.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className={HINT}>
        One per line: a date and a balance, separated by a tab or comma. Dates like 2025-03-31 or
        3/31/2025.
      </p>
      {lines.length > 0 && (
        <>
          <p className="mt-2.5 text-[12.5px] text-[var(--text-secondary)]">
            {`${lines.length} lines read · ${toSave} to save · ${lines.length - toSave} skipped`}
          </p>
          <table className="mt-1.5 w-full border-collapse text-[var(--text-primary)]">
            <tbody>
              {lines.map((c, i) => {
                const tag = tagOf(c, account.currency);
                return (
                  <tr key={i} className={c.saves ? '' : 'opacity-60'}>
                    {c.line.kind === 'ok' ? (
                      <>
                        <td className={`${td} font-mono`}>{c.line.date}</td>
                        <td className={`${td} text-right font-mono`}>
                          {fmtMoney(c.line.balance, { cents: true, currency: account.currency })}
                        </td>
                      </>
                    ) : (
                      <td className={`${td} font-mono`} colSpan={2}>
                        {c.line.text}
                      </td>
                    )}
                    <td className={`${td} text-right ${tag.tone}`}>{tag.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={toSave === 0 || saving} type="button" onClick={save}>
          {`Save ${toSave} balance${toSave === 1 ? '' : 's'}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
