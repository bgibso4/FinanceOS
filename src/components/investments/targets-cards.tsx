'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { finalTargets, targetKey, targetTotals } from '@/lib/investments/targets/allocation';
import type { TargetChange, TargetSettingsView } from '@/lib/investments/targets/settings';
import { ERROR, HINT } from './editor-kit';

/** A security that can be bought, for the "buy with" pickers. */
export type BuyOption = { id: string; label: string };
/** Saves one section; resolves true when it was saved. */
export type SaveSection = (change: TargetChange) => Promise<boolean>;

const TH =
  'px-2 pb-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]';
const TD = 'px-2 py-1.5 align-middle';
const MONO_CELL = `${TD} text-right font-mono text-[13px] text-[var(--text-secondary)]`;
const LINK_BUTTON =
  'text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

/** Accepts "20", "+20", "20%"; anything else is not a number. */
export function parsePct(text: string): number | null {
  const t = text.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)%?$/.test(t) ? Number(t.replace('%', '')) : null;
}

const fraction = (f: number) => `${(f * 100).toFixed(1)}%`;

/** "Total 100%", or the total to 2 places and that it is scaled when it is not 100. */
export const totalNote = (total: number) =>
  Math.abs(total - 100) > 0.005 ? `Total ${total.toFixed(2)}% · scaled to 100%` : 'Total 100%';

/** A percentage field that keeps what is typed, and only reports values that parse. */
function PctInput({
  label,
  signed,
  value,
  onChange,
}: {
  label: string;
  signed?: boolean;
  value: number;
  onChange: (n: number) => void;
}) {
  const shown = (n: number) => (signed && n > 0 ? `+${n}` : String(n));
  const [text, setText] = useState(shown(value));
  useEffect(() => {
    setText((t) => (parsePct(t) === value ? t : shown(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      aria-label={label}
      className="h-9 w-[84px] text-right"
      inputMode="decimal"
      value={text}
      onBlur={() => setText(shown(value))}
      onChange={(e) => {
        setText(e.target.value);
        const n = parsePct(e.target.value);
        if (n !== null) onChange(n);
      }}
    />
  );
}

type Row<T> = T & { key: string };
let newRows = 0;
const withKeys = <T extends { id?: string }>(items: T[]): Row<T>[] =>
  items.map((i) => ({ ...i, key: i.id ?? `new-${++newRows}` }));
const withoutKeys = <T,>(rows: Row<T>[]): T[] =>
  rows.map(({ key: _key, ...r }) => r as unknown as T);

/** The card's own draft of a list: edits stay until saved, other cards' saves don't discard them. */
function useDraft<T extends { id?: string }>(saved: T[]) {
  const source = useMemo(() => withKeys(saved), [saved]);
  const [edited, setEdited] = useState<Row<T>[] | null>(null);
  const rows = edited ?? source;
  const dirty = edited !== null && JSON.stringify(edited) !== JSON.stringify(source);
  const patch = (key: string, change: Partial<T>) =>
    setEdited(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const remove = (key: string) => setEdited(rows.filter((r) => r.key !== key));
  const add = (item: T) => setEdited([...rows, ...withKeys([item])]);
  const reset = () => setEdited(null);
  return { rows, dirty, patch, remove, add, reset };
}

function CardShell({
  action,
  children,
  subtitle,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <Card aria-label={title} className="p-6" role="region">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="mt-1 max-w-[62ch] text-[12.5px] text-[var(--text-secondary)]">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** The footer of an editable list: add link, a note, the error, and that card's Save. */
function ListFooter({
  add,
  addLabel,
  dirty,
  error,
  note,
  onSave,
  saving,
}: {
  add: () => void;
  addLabel: string;
  dirty: boolean;
  error: string | null;
  note: ReactNode;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button className={LINK_BUTTON} type="button" onClick={add}>
            {addLabel}
          </button>
          <span className="font-mono text-xs text-[var(--text-muted)]">{note}</span>
        </div>
        <Button disabled={!dirty || saving} type="button" onClick={onSave}>
          Save
        </Button>
      </div>
      {error && <p className={ERROR}>{error}</p>}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button aria-label={label} className="h-8 px-2" type="button" variant="ghost" onClick={onClick}>
      ✕
    </Button>
  );
}

function BuyWithSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (id: string | null) => void;
  options: BuyOption[];
  value: string | null;
}) {
  return (
    <Select
      aria-label={label}
      className="h-9"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">None</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

type CardProps = { error: string | null; saving: boolean; onSave: SaveSection };

type ClassItem = Extract<TargetChange, { section: 'classes' }>['items'][number];
type RegionItem = Extract<TargetChange, { section: 'regions' }>['items'][number];
type CountryItem = Extract<TargetChange, { section: 'countries' }>['items'][number];

export function ClassesCard({
  buyOptions,
  error,
  onSave,
  saving,
  view,
}: CardProps & { buyOptions: BuyOption[]; view: TargetSettingsView }) {
  const d = useDraft<ClassItem>(view.classes);
  const total = d.rows.reduce((s, r) => s + r.pct, 0);
  return (
    <CardShell
      subtitle="How everything counted is split. Set one to 0 when you don’t hold it."
      title="Asset classes"
    >
      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Class</th>
            <th className={`${TH} text-right`}>Target</th>
            <th className={TH}>Buy with</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.key}>
              <td className={TD}>
                <Input
                  aria-label="Class name"
                  className="h-9"
                  value={r.name}
                  onChange={(e) => d.patch(r.key, { name: e.target.value })}
                />
              </td>
              <td className={`${TD} text-right`}>
                <PctInput
                  label={`Target for ${r.name}`}
                  value={r.pct}
                  onChange={(pct) => d.patch(r.key, { pct })}
                />
              </td>
              <td className={TD}>
                {r.splitByRegion ? (
                  <span className="text-[12.5px] text-[var(--text-muted)]">
                    Split by region, below
                  </span>
                ) : (
                  <BuyWithSelect
                    label={`Buy with for ${r.name}`}
                    options={buyOptions}
                    value={r.buySecurityId}
                    onChange={(buySecurityId) => d.patch(r.key, { buySecurityId })}
                  />
                )}
              </td>
              <td className={`${TD} text-right`}>
                {!r.splitByRegion && (
                  <RemoveButton label={`Remove ${r.name}`} onClick={() => d.remove(r.key)} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ListFooter
        add={() => d.add({ name: 'New class', pct: 0, splitByRegion: false, buySecurityId: null })}
        addLabel="+ Add class"
        dirty={d.dirty}
        error={error}
        note={totalNote(total)}
        saving={saving}
        onSave={async () => {
          if (await onSave({ section: 'classes', items: withoutKeys(d.rows) })) d.reset();
        }}
      />
    </CardShell>
  );
}

export function RegionsCard({
  buyOptions,
  error,
  onSave,
  saving,
  view,
}: CardProps & { buyOptions: BuyOption[]; view: TargetSettingsView }) {
  const d = useDraft<RegionItem>(view.regions);
  const split = view.classes.find((c) => c.splitByRegion);
  // Preview from this draft; ids are only needed to match countries, so new rows use their key.
  const preview = useMemo(
    () =>
      finalTargets({
        classes: view.classes,
        countries: view.countries,
        regions: d.rows.map((r) => ({ ...r, id: r.id ?? r.key })),
      }).filter((t) => t.classId === split?.id),
    [view.classes, view.countries, d.rows, split?.id]
  );
  const forRow = (r: { id?: string; key: string }) =>
    preview.find((t) => t.regionId === (r.id ?? r.key));
  return (
    <CardShell
      subtitle={`Splits the ${split?.name ?? 'stocks'} ${split?.pct ?? 0}%. Market weight comes from the countries below; tilt raises or lowers a region, then they’re scaled to 100% of ${split?.name.toLowerCase() ?? 'stocks'}.`}
      title={`${split?.name ?? 'Stocks'} by region`}
    >
      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Region</th>
            <th className={`${TH} text-right`}>Market weight</th>
            <th className={`${TH} text-right`}>Tilt</th>
            <th className={`${TH} text-right`}>Of stocks</th>
            <th className={`${TH} text-right`}>Overall</th>
            <th className={TH}>Buy with</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => {
            const t = forRow(r);
            return (
              <tr key={r.key}>
                <td className={TD}>
                  <Input
                    aria-label="Region name"
                    className="h-9"
                    value={r.name}
                    onChange={(e) => d.patch(r.key, { name: e.target.value })}
                  />
                </td>
                <td className={MONO_CELL}>
                  {t?.marketWeightPct != null ? `${t.marketWeightPct.toFixed(2)}%` : '—'}
                </td>
                <td className={`${TD} text-right`}>
                  <PctInput
                    signed
                    label={`Tilt for ${r.name}`}
                    value={r.tiltPct}
                    onChange={(tiltPct) => d.patch(r.key, { tiltPct })}
                  />
                </td>
                <td className={MONO_CELL}>
                  {t?.shareOfClass != null ? fraction(t.shareOfClass) : '—'}
                </td>
                <td className={`${MONO_CELL} font-semibold text-[var(--text-primary)]`}>
                  {t ? fraction(t.target) : '—'}
                </td>
                <td className={TD}>
                  <BuyWithSelect
                    label={`Buy with for ${r.name}`}
                    options={buyOptions}
                    value={r.buySecurityId}
                    onChange={(buySecurityId) => d.patch(r.key, { buySecurityId })}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RemoveButton label={`Remove ${r.name}`} onClick={() => d.remove(r.key)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ListFooter
        add={() => d.add({ name: 'New region', tiltPct: 0, buySecurityId: null })}
        addLabel="+ Add region"
        dirty={d.dirty}
        error={error}
        note="Try a US tilt of +20 to see targets move."
        saving={saving}
        onSave={async () => {
          if (await onSave({ section: 'regions', items: withoutKeys(d.rows) })) d.reset();
        }}
      />
    </CardShell>
  );
}

export function CountriesCard({
  error,
  onSave,
  saving,
  view,
}: CardProps & { view: TargetSettingsView }) {
  const d = useDraft<CountryItem>(view.countries);
  const total = targetTotals({ ...view, countries: d.rows }).countryWeightPct;
  return (
    <CardShell
      subtitle="Each country’s share of the global stock market, for splitting stocks. Update once a year."
      title="Countries"
    >
      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Country</th>
            <th className={`${TH} text-right`}>Weight</th>
            <th className={TH}>Region</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.key}>
              <td className={TD}>
                <Input
                  aria-label="Country"
                  className="h-9"
                  value={r.name}
                  onChange={(e) => d.patch(r.key, { name: e.target.value })}
                />
              </td>
              <td className={`${TD} text-right`}>
                <PctInput
                  label={`Weight for ${r.name}`}
                  value={r.weightPct}
                  onChange={(weightPct) => d.patch(r.key, { weightPct })}
                />
              </td>
              <td className={TD}>
                <Select
                  aria-label={`Region for ${r.name}`}
                  className="h-9"
                  value={r.regionId}
                  onChange={(e) => d.patch(r.key, { regionId: e.target.value })}
                >
                  {view.regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </Select>
              </td>
              <td className={`${TD} text-right`}>
                <RemoveButton label={`Remove ${r.name}`} onClick={() => d.remove(r.key)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ListFooter
        add={() =>
          d.add({ name: 'New country', weightPct: 0, regionId: view.regions[0]?.id ?? '' })
        }
        addLabel="+ Add country"
        dirty={d.dirty}
        error={error}
        note={totalNote(total)}
        saving={saving}
        onSave={async () => {
          if (await onSave({ section: 'countries', items: withoutKeys(d.rows) })) d.reset();
        }}
      />
    </CardShell>
  );
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Saves on change: one fund's target is sent with every other fund's current one. */
export function FundsCard({
  error,
  onSave,
  saving,
  view,
}: CardProps & { view: TargetSettingsView }) {
  const label = (t: TargetSettingsView['final'][number]) =>
    t.className ? `${t.className} · ${t.name}` : t.name;
  const assign = (securityId: string, key: string) => {
    const target = view.final.find((t) => t.key === key);
    return onSave({
      section: 'funds',
      items: view.funds.map((f) => {
        if (f.securityId !== securityId) {
          return { securityId: f.securityId, classId: f.classId, regionId: f.regionId };
        }
        return { securityId, classId: target?.classId ?? null, regionId: target?.regionId ?? null };
      }),
    });
  };
  return (
    <CardShell subtitle="Which target each fund you hold counts toward." title="Funds">
      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Fund</th>
            <th className={TH}>Held in</th>
            <th className={`${TH} text-right`}>Value</th>
            <th className={TH}>Counts toward</th>
          </tr>
        </thead>
        <tbody>
          {view.funds.map((f) => {
            const current = targetKey(f.classId ?? '', f.regionId);
            return (
              <tr key={f.securityId}>
                <td className={TD}>
                  <div className="font-mono text-[13px] text-[var(--text-primary)]">{f.label}</div>
                  <div className="text-[11.5px] text-[var(--text-muted)]">{f.name}</div>
                </td>
                <td className={`${TD} text-[12.5px] text-[var(--text-secondary)]`}>
                  {f.heldIn.join(', ')}
                </td>
                <td className={MONO_CELL}>{money(f.valueBase)}</td>
                <td className={TD}>
                  <Select
                    aria-label={`Target for ${f.label}`}
                    className="h-9"
                    disabled={saving}
                    value={view.final.some((t) => t.key === current) ? current : ''}
                    onChange={(e) => assign(f.securityId, e.target.value)}
                  >
                    <option value="">Not counted</option>
                    {view.final.map((t) => (
                      <option key={t.key} value={t.key}>
                        {label(t)}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className={ERROR}>{error}</p>}
    </CardShell>
  );
}

/** Saves on change: ticking an account sends every account's current state. */
export function AccountsCard({
  error,
  onSave,
  saving,
  view,
}: CardProps & { view: TargetSettingsView }) {
  const toggle = (id: string, inTargets: boolean) =>
    onSave({
      section: 'accounts',
      items: view.accounts.map((a) => ({
        accountId: a.id,
        inTargets: a.id === id ? inTargets : a.inTargets,
      })),
    });
  return (
    <CardShell subtitle="Ticked accounts count toward your targets." title="Accounts">
      <ul>
        {view.accounts.map((a) => (
          <li key={a.id} className="border-b border-[var(--border)] last:border-b-0">
            <label className="flex cursor-pointer items-start gap-3 py-2.5">
              <input
                checked={a.inTargets}
                className="mt-1"
                disabled={saving}
                type="checkbox"
                onChange={(e) => toggle(a.id, e.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-[var(--text-primary)]">{a.name}</span>
                {a.typedBalance && (
                  <span className={`${HINT} mt-0 block`}>
                    typed-in balance, left out even when ticked (enter its holdings to count it)
                  </span>
                )}
              </span>
              <span className="font-mono text-[13px] text-[var(--text-secondary)]">
                {money(a.valueBase)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className={ERROR}>{error}</p>}
    </CardShell>
  );
}
