'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { PriceTarget } from '@/lib/investments/holdings-view';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';
import { fmtDay, fmtMoney } from './format';

type PatchBody = { priceSymbol: string } | { manualPrice: number } | { proxySymbol: string | null };

export function SetSymbolModal({
  security,
  hint,
  onClose,
  onSaved,
}: {
  security: PriceTarget;
  /** How to write a price symbol, from the market data provider. */
  hint: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [proxy, setProxy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const quote = security.institution;

  const patch = async (body: PatchBody) => {
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/securities/${security.securityId}`, 'PATCH', body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const useSymbol = () => {
    if (!symbol.trim()) return setError('Enter a symbol');
    void patch({ priceSymbol: symbol.trim() });
  };
  const setManualPrice = () => {
    const value = Number(price);
    if (!price.trim() || !Number.isFinite(value) || value <= 0) {
      return setError('Enter a positive price');
    }
    void patch({ manualPrice: value });
  };
  const follow = () => {
    if (!proxy.trim()) return setError('Enter a fund symbol');
    void patch({ proxySymbol: proxy.trim() });
  };

  return (
    <Modal isOpen title={`Price ${security.label}`} onClose={onClose}>
      {quote && (
        <p className={`${HINT} mb-3`}>
          Priced by the institution:{' '}
          <span className="font-mono text-[var(--text-secondary)]">
            {fmtMoney(quote.price, { cents: true, currency: quote.currency })}
          </span>{' '}
          on {fmtDay(quote.date)}.
        </p>
      )}
      <label className={FIELD_LABEL} htmlFor="set-symbol-symbol">
        Price symbol
      </label>
      <div className="flex gap-2">
        <Input
          className="font-mono"
          id="set-symbol-symbol"
          placeholder="e.g. VTI or XIU.TO"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <Button disabled={saving} type="button" onClick={useSymbol}>
          Use symbol
        </Button>
      </div>
      {hint && <p className={HINT}>{hint}</p>}
      <label className={`${FIELD_LABEL} mt-4`} htmlFor="set-symbol-price">
        Or set a price per unit
      </label>
      <div className="flex gap-2">
        <Input
          className="font-mono"
          id="set-symbol-price"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Button disabled={saving} type="button" variant="outline" onClick={setManualPrice}>
          Set price
        </Button>
      </div>
      {quote && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className={FIELD_LABEL}>No public ticker? Follow a similar fund</p>
          {quote.proxy ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
              <span>
                Following <span className="font-mono">{quote.proxy.symbol}</span>{' '}
                <span className="text-[var(--text-muted)]">· {quote.proxy.name}</span>
              </span>
              <button
                className="text-[var(--text-muted)] underline hover:text-[var(--text-secondary)]"
                disabled={saving}
                type="button"
                onClick={() => void patch({ proxySymbol: null })}
              >
                Stop following
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                aria-label="Fund to follow"
                className="font-mono"
                placeholder="Ticker"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
              />
              <Button disabled={saving} type="button" onClick={follow}>
                Follow fund
              </Button>
            </div>
          )}
          <p className={HINT}>
            The institution’s price stays the real price. On days without one, this holding moves
            with the fund you pick, which fills in history before the first sync and any days the
            app didn’t sync.
          </p>
        </div>
      )}
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
