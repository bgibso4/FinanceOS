'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { HoldingKind, HoldingRow } from '@/lib/investments/holdings-view';
import type { SymbolMatch } from '@/lib/prices/types';
import { fmtDay, fmtMoney } from './format';
import { FlagPill } from './pills';
import { ERROR, HINT, errorText, sendJson } from './editor-kit';

type EditorRow = {
  securityId: string;
  label: string;
  name: string;
  kind: HoldingKind;
  units: string;
  priceInAccount: number | null;
  unpriced: boolean;
};

type AddedSecurity = { id: string; ticker: string | null; name: string; pricing: string };

const SEARCH_DELAY_MS = 300;
const CELL = 'border-t border-[var(--border)] py-1.5 pr-2';

export function HoldingsEditorModal({
  account,
  holdings,
  pricesAsOf,
  onClose,
  onSaved,
}: {
  account: { id: string; name: string; currency: string };
  holdings: HoldingRow[];
  pricesAsOf: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<EditorRow[]>(() =>
    holdings
      .filter((h) => h.kind !== 'account')
      .map((h) => ({
        securityId: h.securityId,
        label: h.label,
        name: h.name,
        kind: h.kind,
        units: String(h.quantity),
        priceInAccount: h.priceInAccount,
        unpriced: h.pricing === 'none',
      }))
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      sendJson<{ results: SymbolMatch[] }>(
        `/api/investments/securities/search?q=${encodeURIComponent(q)}`,
        'GET'
      )
        .then((data) => setResults(data.results))
        .catch((err) => setError(errorText(err)));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const rowsRef = useRef(rows);
  const addingRef = useRef(false);
  const commitRows = (next: EditorRow[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const addRow = (row: EditorRow) => {
    if (rowsRef.current.some((r) => r.securityId === row.securityId)) {
      setError(`${row.label} is already listed`);
      return;
    }
    commitRows([...rowsRef.current, row]);
  };

  const add = async (body: { symbol: string } | { cash: string }, kind: HoldingKind) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setError(null);
    try {
      const { security } = await sendJson<{ security: AddedSecurity }>(
        '/api/investments/securities',
        'POST',
        body
      );
      addRow({
        securityId: security.id,
        label: kind === 'cash' ? 'Cash' : (security.ticker ?? security.name),
        name: security.name,
        kind,
        units: '',
        priceInAccount: kind === 'cash' ? 1 : null,
        unpriced: security.pricing === 'none',
      });
      setQuery('');
      setResults([]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const save = async () => {
    if (!rows.length) {
      setError('Add at least one holding');
      return;
    }
    const quantities = rows.map((r) => Number(r.units));
    if (quantities.some((q) => !Number.isFinite(q) || q <= 0)) {
      setError('Units must be positive numbers');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/accounts/${account.id}/holdings`, 'PUT', {
        holdings: rows.map((r, i) => ({ securityId: r.securityId, quantity: quantities[i] })),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const valueOf = (r: EditorRow) =>
    r.priceInAccount == null || !Number(r.units) ? null : Number(r.units) * r.priceInAccount;
  const total = rows.reduce((sum, r) => sum + (valueOf(r) ?? 0), 0);
  const money = (v: number, cents = false) => fmtMoney(v, { cents, currency: account.currency });

  return (
    <Modal isOpen size="lg" title={`Edit holdings · ${account.name}`} onClose={onClose}>
      {pricesAsOf && (
        <p className="mb-2 text-right text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]">
          valued daily · prices as of {fmtDay(pricesAsOf)} close
        </p>
      )}
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]">
            <th className="w-[38%] pb-1.5 text-left font-normal">Security</th>
            <th className="pb-1.5 text-right font-normal">Units</th>
            <th className="pb-1.5 text-right font-normal">Price ({account.currency})</th>
            <th className="pb-1.5 text-right font-normal">Value ({account.currency})</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const value = valueOf(r);
            return (
              <tr key={r.securityId}>
                <td className={CELL}>
                  <span className="font-mono font-medium text-[var(--text-primary)]">
                    {r.label}
                  </span>
                  {r.unpriced && <FlagPill>No price source</FlagPill>}
                  <span className="block text-[11px] text-[var(--text-muted)]">{r.name}</span>
                </td>
                <td className={`${CELL} text-right`}>
                  <Input
                    aria-label={`Units for ${r.label}`}
                    className="ml-auto h-8 w-28 text-right font-mono"
                    inputMode="decimal"
                    value={r.units}
                    onChange={(e) =>
                      commitRows(
                        rowsRef.current.map((c) =>
                          c.securityId === r.securityId ? { ...c, units: e.target.value } : c
                        )
                      )
                    }
                  />
                </td>
                <td
                  className={`${CELL} text-right font-mono ${r.unpriced ? 'text-[var(--accent)]' : ''}`}
                >
                  {r.priceInAccount == null ? '—' : money(r.priceInAccount, true)}
                  {r.unpriced && '*'}
                </td>
                <td className={`${CELL} text-right font-mono`}>
                  {value == null ? '—' : money(value)}
                </td>
                <td className={`${CELL} text-right`}>
                  <button
                    aria-label={`Remove ${r.label}`}
                    className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    type="button"
                    onClick={() =>
                      commitRows(rowsRef.current.filter((c) => c.securityId !== r.securityId))
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td className={CELL} colSpan={2}>
              <Input
                className="h-8"
                placeholder="+ Add security — search ticker (e.g. VTI)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 && (
                <div className="mt-1 rounded-lg border border-[var(--border-hover)] bg-[var(--bg-base)]">
                  {results.map((m) => (
                    <button
                      key={m.symbol}
                      className="block w-full px-2.5 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)]"
                      disabled={adding}
                      type="button"
                      onClick={() => add({ symbol: m.symbol }, 'security')}
                    >
                      {[m.symbol, m.name, m.exchange].filter(Boolean).join(' · ')}
                    </button>
                  ))}
                </div>
              )}
            </td>
            <td className={CELL} colSpan={3}>
              <Button
                disabled={adding}
                type="button"
                variant="ghost"
                onClick={() => add({ cash: account.currency }, 'cash')}
              >
                + Add cash
              </Button>
            </td>
          </tr>
          <tr>
            <td className={`${CELL} font-medium`} colSpan={3}>
              Total
            </td>
            <td className={`${CELL} text-right font-mono font-medium`}>{money(total)}</td>
            <td className={CELL} />
          </tr>
        </tbody>
      </table>
      <p className={HINT}>
        * Last known price. Units are what you hold today — edit them when you buy or sell; history
        keeps the old quantities.
      </p>
      {error && <p className={ERROR}>{error}</p>}
      <div className="mt-3.5 flex justify-end">
        <Button disabled={saving} type="button" onClick={save}>
          Save holdings
        </Button>
      </div>
    </Modal>
  );
}
