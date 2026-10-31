'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BalanceSource } from '@/lib/investments/codes';
import type { HoldingRow } from '@/lib/investments/holdings-view';
import { SECTION_CARD, SECTION_HEAD, SECTION_SUB } from './account-drawer';
import { ERROR, HINT, errorText, sendJson } from './editor-kit';
import { fmtMoney, fmtQty } from './format';
import { HoldingsEditorModal } from './holdings-editor-modal';

type HoldingsData = { holdings: HoldingRow[]; pricesAsOf: string | null };

const TH =
  'pb-1.5 pr-2 text-[10.5px] font-medium uppercase tracking-[0.5px] text-[var(--text-muted)]';
const TD = 'border-t border-[var(--border)] py-[7px] pr-2 text-[12.5px]';

export function AccountHoldingsSection({
  account,
  onChanged,
}: {
  account: { id: string; name: string; currency: string; balanceSource: BalanceSource };
  onChanged: () => void;
}) {
  const [data, setData] = useState<HoldingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const valued = account.balanceSource === BalanceSource.Valuation;

  const load = useCallback(async () => {
    try {
      setData(
        await sendJson<HoldingsData>(`/api/investments/accounts/${account.id}/holdings`, 'GET')
      );
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [account.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (v: number) => fmtMoney(v, { cents: true, currency: account.currency });

  return (
    <section className={SECTION_CARD}>
      <h4 className={SECTION_HEAD}>
        Holdings
        <span className={SECTION_SUB}>
          {valued ? 'valued at daily closes' : 'from the connection'}
        </span>
      </h4>
      {data && data.holdings.length === 0 && <p className={HINT}>No holdings yet.</p>}
      {data && data.holdings.length > 0 && (
        <table className="w-full border-collapse text-[var(--text-primary)]">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Security</th>
              <th className={`${TH} text-right`}>Units</th>
              <th className={`${TH} text-right`}>Price</th>
              <th className={`${TH} text-right`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {data.holdings.map((h) => (
              <tr key={h.securityId}>
                <td className={TD}>
                  <span className="font-mono font-medium">{h.label}</span>
                  <span className="block text-[11px] text-[var(--text-muted)]">{h.name}</span>
                </td>
                <td className={`${TD} text-right font-mono`}>{fmtQty(h.quantity)}</td>
                <td className={`${TD} text-right font-mono`}>{money(h.priceInAccount)}</td>
                <td className={`${TD} text-right font-mono`}>{money(h.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
      {valued && data && (
        <div className="mt-3.5 flex justify-end">
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Edit holdings
          </Button>
        </div>
      )}
      {editing && data && (
        <HoldingsEditorModal
          account={account}
          holdings={data.holdings}
          pricesAsOf={data.pricesAsOf}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load().then(onChanged);
          }}
        />
      )}
    </section>
  );
}
