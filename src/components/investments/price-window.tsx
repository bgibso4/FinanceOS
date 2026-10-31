'use client';

import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Pricing } from '@/lib/investments/codes';
import type { SecurityListItem } from '@/lib/investments/security-list';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';
import { latestView, priceSourceView } from './securities-view';

type PatchBody = { priceSymbol: string } | { manualPrice: number } | { proxySymbol: string | null };

/** The ways to price a security; each is a card in the window. */
type Source = typeof Pricing.Institution | typeof Pricing.Market | typeof Pricing.Manual;
/** Each option's field value. */
type Values = Record<Source, string>;

/** What an option's field needs from the window. */
type FieldProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
  /** How to write a price symbol, from the market data provider. */
  hint: string;
};

function FieldInput({
  field,
  ...attrs
}: { field: FieldProps } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <Input
      ref={field.inputRef}
      className="font-mono"
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      {...attrs}
    />
  );
}

type PriceOption = {
  source: Source;
  title: string;
  description: string;
  /** The field's value when the window opens. */
  initial: (s: SecurityListItem) => string;
  field: (f: FieldProps) => ReactNode;
};

const OPTIONS: PriceOption[] = [
  {
    source: Pricing.Institution,
    title: 'Institution price',
    description: 'The price your institution reports for it.',
    initial: (s) => s.proxySymbol ?? '',
    field: (f) => (
      <>
        <label className={FIELD_LABEL} htmlFor="price-window-proxy">
          Follow a similar fund between institution prices{' '}
          <span className="font-normal text-[var(--text-muted)]">· optional</span>
        </label>
        <FieldInput field={f} id="price-window-proxy" placeholder="Ticker" />
        <p className={HINT}>
          The institution’s price stays the real price. On days without one, this holding moves with
          the fund you pick.
        </p>
      </>
    ),
  },
  {
    source: Pricing.Market,
    title: 'Market symbol',
    description: 'Daily closes from the market data provider.',
    initial: (s) => (s.pricing === Pricing.Market ? (s.priceSymbol ?? '') : ''),
    field: (f) => (
      <>
        <label className={FIELD_LABEL} htmlFor="price-window-symbol">
          Symbol
        </label>
        <FieldInput field={f} id="price-window-symbol" placeholder="e.g. VTI or XIU.TO" />
        {f.hint && <p className={HINT}>{f.hint}</p>}
      </>
    ),
  },
  {
    source: Pricing.Manual,
    title: 'Manual price',
    description: 'A price per unit you enter. It stays until you change it.',
    initial: (s) => (s.pricing === Pricing.Manual && s.latest ? String(s.latest.price) : ''),
    field: (f) => (
      <>
        <label className={FIELD_LABEL} htmlFor="price-window-price">
          Price per unit
        </label>
        <FieldInput field={f} id="price-window-price" inputMode="decimal" placeholder="0.00" />
      </>
    ),
  },
];

/** How one security is priced now, and the one source to switch it to (Settings → Securities). */
export function PriceWindow({
  security,
  hint,
  onClose,
  onSaved,
}: {
  security: SecurityListItem;
  /** How to write a price symbol, from the market data provider. */
  hint: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const offered = OPTIONS.filter(
    (o) =>
      o.source !== Pricing.Institution ||
      security.pricing === Pricing.Institution ||
      security.hasInstitutionPrice
  );
  const opening = offered.find((o) => o.source === security.pricing)?.source ?? null;
  const initial = Object.fromEntries(OPTIONS.map((o) => [o.source, o.initial(security)])) as Values;

  const [selected, setSelected] = useState<Source | null>(opening);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when an option's head is clicked; its field takes focus once rendered.
  const [focusing, setFocusing] = useState<Source | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const source = priceSourceView(security);
  const latest = latestView(security);

  useEffect(() => {
    if (!focusing) return;
    fieldRef.current?.focus();
    setFocusing(null);
  }, [focusing]);

  const changed =
    selected !== null &&
    (selected !== opening || values[selected].trim() !== initial[selected].trim());

  const pick = (next: Source) => {
    setSelected(next);
    setError(null);
  };

  const body = (): PatchBody | null => {
    const value = selected ? values[selected].trim() : '';
    if (selected === Pricing.Institution) return { proxySymbol: value || null };
    if (selected === Pricing.Market) {
      if (!value) return fail('Enter a symbol');
      return { priceSymbol: value };
    }
    const price = Number(value);
    if (!value || !Number.isFinite(price) || price <= 0) return fail('Enter a positive price');
    return { manualPrice: price };
  };
  const fail = (message: string) => {
    setError(message);
    return null;
  };

  const save = async () => {
    const payload = body();
    if (!payload) return;
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/securities/${security.id}`, 'PATCH', payload);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen title={`How ${security.label} is priced`} onClose={onClose}>
      <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
        <span className="text-[var(--text-muted)]">Currently</span>{' '}
        <b className={`font-medium ${source.warn ? 'text-[var(--accent)]' : ''}`}>{source.name}</b>
        {latest && (
          <>
            {' · '}
            <span className="font-mono">{latest.price}</span>
            {latest.date && <span className="text-[var(--text-muted)]"> on {latest.date}</span>}
          </>
        )}
      </p>
      <p
        className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--text-muted)]"
        id="price-window-sources"
      >
        Price it with
      </p>
      <div aria-labelledby="price-window-sources" className="grid gap-2" role="radiogroup">
        {offered.map((o) => {
          const on = o.source === selected;
          const described = `price-window-${o.source}-description`;
          return (
            <div
              key={o.source}
              className={`rounded-[10px] border transition-colors ${
                on
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg-card))]'
                  : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]'
              }`}
            >
              {/* Clicking the head picks and focuses the field; arrow keys only pick. */}
              <label
                className="grid cursor-pointer grid-cols-[18px_1fr] items-start gap-2.5 px-3 py-[11px]"
                onClick={(e) => {
                  if (e.target instanceof HTMLInputElement) return; // the radio's own click
                  e.preventDefault();
                  pick(o.source);
                  setFocusing(o.source);
                }}
              >
                <input
                  aria-describedby={described}
                  aria-label={o.title}
                  checked={on}
                  className="peer sr-only"
                  name="price-source"
                  type="radio"
                  onChange={() => pick(o.source)}
                />
                <span
                  aria-hidden
                  className={`mt-px inline-flex size-4 items-center justify-center rounded-full border-[1.5px] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--bg-card)] ${
                    on ? 'border-[var(--accent)]' : 'border-[var(--border-hover)]'
                  }`}
                >
                  {on && <span className="size-2 rounded-full bg-[var(--accent)]" />}
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                    {o.title}
                  </span>
                  <span
                    className="mt-0.5 block text-[11.5px] leading-snug text-[var(--text-muted)]"
                    id={described}
                  >
                    {o.description}
                  </span>
                </span>
              </label>
              {on && (
                <div className="pb-3 pl-10 pr-3">
                  {o.field({
                    value: values[o.source],
                    onChange: (value) => setValues((v) => ({ ...v, [o.source]: value })),
                    inputRef: fieldRef,
                    hint,
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button
          className="whitespace-nowrap"
          disabled={saving}
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className="whitespace-nowrap"
          disabled={saving || !changed}
          type="button"
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
