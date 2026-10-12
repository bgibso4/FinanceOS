'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';

export function SetSymbolModal({
  security,
  onClose,
  onSaved,
}: {
  security: { securityId: string; label: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = async (body: { priceSymbol: string } | { manualPrice: number }) => {
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

  return (
    <Modal isOpen title={`Price ${security.label}`} onClose={onClose}>
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
      <p className={HINT}>
        Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.
      </p>
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
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
