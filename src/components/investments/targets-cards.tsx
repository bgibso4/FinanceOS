'use client';

import { useMemo } from 'react';
import { Select } from '@/components/ui/select';
import { fmtMoney } from '@/lib/currency';
import { finalTargets, targetKey, targetTotals } from '@/lib/investments/targets/allocation';
import type { TargetChange, TargetSettingsView } from '@/lib/investments/targets/settings';
import { ERROR, HINT } from './editor-kit';
import {
  BuyWithSelect,
  CardShell,
  EditableList,
  MONO_CELL,
  NameCell,
  PctCell,
  RemoveCell,
  TD,
  TableHead,
  fraction,
  totalNote,
  type BuyOption,
  type Draft,
} from './targets-kit';

/** Saves one section; resolves true when it was saved. */
export type SaveSection = (change: TargetChange) => Promise<boolean>;

type CardProps = { error: string | null; saving: boolean; onSave: SaveSection };
type Items<S extends TargetChange['section']> = Extract<TargetChange, { section: S }>['items'];

export type ClassItem = Items<'classes'>[number];
export type RegionItem = Items<'regions'>[number];
export type CountryItem = Items<'countries'>[number];

export function ClassesCard({
  buyOptions,
  draft,
  error,
  onSave,
  saving,
}: CardProps & { buyOptions: BuyOption[]; draft: Draft<ClassItem> }) {
  return (
    <EditableList<ClassItem>
      addLabel="+ Add class"
      columns={[
        { label: 'Class' },
        { label: 'Target', right: true },
        { label: 'Buy with' },
        { label: '' },
      ]}
      draft={draft}
      error={error}
      newItem={{ name: 'New class', pct: 0, splitByRegion: false, buySecurityId: null }}
      note={totalNote(draft.rows.reduce((s, r) => s + r.pct, 0))}
      renderRow={(r) => (
        <>
          <NameCell
            label="Class name"
            value={r.name}
            onChange={(name) => draft.patch(r.key, { name })}
          />
          <PctCell
            label={`Target for ${r.name}`}
            value={r.pct}
            onChange={(pct) => draft.patch(r.key, { pct })}
          />
          <td className={TD}>
            {r.splitByRegion ? (
              <span className="text-[12.5px] text-[var(--text-muted)]">Split by region, below</span>
            ) : (
              <BuyWithSelect
                label={`Buy with for ${r.name}`}
                options={buyOptions}
                value={r.buySecurityId}
                onChange={(buySecurityId) => draft.patch(r.key, { buySecurityId })}
              />
            )}
          </td>
          {r.splitByRegion ? (
            <td className={TD} />
          ) : (
            <RemoveCell label={`Remove ${r.name}`} onClick={() => draft.remove(r.key)} />
          )}
        </>
      )}
      saving={saving}
      subtitle="How everything counted is split. Set one to 0 when you don’t hold it."
      title="Asset classes"
      onSave={(items) => onSave({ section: 'classes', items })}
    />
  );
}

export function RegionsCard({
  buyOptions,
  draft,
  error,
  onSave,
  saving,
  usedRegionIds,
  view,
}: CardProps & {
  buyOptions: BuyOption[];
  draft: Draft<RegionItem>;
  /** Regions that some country (saved or in the countries draft) still points at. */
  usedRegionIds: Set<string>;
  view: TargetSettingsView;
}) {
  const split = view.classes.find((c) => c.splitByRegion);
  // Preview from this draft; new rows have no id yet, so their key stands in for it.
  const preview = useMemo(
    () =>
      finalTargets({
        classes: view.classes,
        countries: view.countries,
        regions: draft.rows.map((r) => ({ ...r, id: r.id ?? r.key })),
      }).filter((t) => t.classId === split?.id),
    [view.classes, view.countries, draft.rows, split?.id]
  );
  const name = split?.name ?? 'Stocks';
  return (
    <EditableList<RegionItem>
      addLabel="+ Add region"
      columns={[
        { label: 'Region' },
        { label: 'Market weight', right: true },
        { label: 'Tilt', right: true },
        { label: 'Of stocks', right: true },
        { label: 'Overall', right: true },
        { label: 'Buy with' },
        { label: '' },
      ]}
      draft={draft}
      error={error}
      newItem={{ name: 'New region', tiltPct: 0, buySecurityId: null }}
      note="Try a US tilt of +20 to see targets move."
      renderRow={(r) => {
        const t = preview.find((p) => p.regionId === (r.id ?? r.key));
        return (
          <>
            <NameCell
              label="Region name"
              value={r.name}
              onChange={(n) => draft.patch(r.key, { name: n })}
            />
            <td className={MONO_CELL}>
              {t?.marketWeightPct != null ? `${t.marketWeightPct.toFixed(2)}%` : '—'}
            </td>
            <PctCell
              signed
              label={`Tilt for ${r.name}`}
              value={r.tiltPct}
              onChange={(tiltPct) => draft.patch(r.key, { tiltPct })}
            />
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
                onChange={(buySecurityId) => draft.patch(r.key, { buySecurityId })}
              />
            </td>
            <RemoveCell
              blockedReason={
                r.id && usedRegionIds.has(r.id)
                  ? 'Move its countries to another region first'
                  : undefined
              }
              label={`Remove ${r.name}`}
              onClick={() => draft.remove(r.key)}
            />
          </>
        );
      }}
      saving={saving}
      subtitle={`Splits the ${name} ${split?.pct ?? 0}%. Market weight comes from the countries below; tilt raises or lowers a region, then they’re scaled to 100% of ${name.toLowerCase()}.`}
      title={`${name} by region`}
      onSave={(items) => onSave({ section: 'regions', items })}
    />
  );
}

export function CountriesCard({
  draft,
  error,
  onSave,
  saving,
  view,
}: CardProps & { draft: Draft<CountryItem>; view: TargetSettingsView }) {
  return (
    <EditableList<CountryItem>
      addLabel="+ Add country"
      columns={[
        { label: 'Country' },
        { label: 'Weight', right: true },
        { label: 'Region' },
        { label: '' },
      ]}
      draft={draft}
      error={error}
      newItem={{ name: 'New country', weightPct: 0, regionId: view.regions[0]?.id ?? '' }}
      note={totalNote(targetTotals({ ...view, countries: draft.rows }).countryWeightPct)}
      renderRow={(r) => (
        <>
          <NameCell
            label="Country"
            value={r.name}
            onChange={(name) => draft.patch(r.key, { name })}
          />
          <PctCell
            label={`Weight for ${r.name}`}
            value={r.weightPct}
            onChange={(weightPct) => draft.patch(r.key, { weightPct })}
          />
          <td className={TD}>
            <Select
              aria-label={`Region for ${r.name}`}
              className="h-9"
              value={r.regionId}
              onChange={(e) => draft.patch(r.key, { regionId: e.target.value })}
            >
              {view.regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
          </td>
          <RemoveCell label={`Remove ${r.name}`} onClick={() => draft.remove(r.key)} />
        </>
      )}
      saving={saving}
      subtitle="Each country’s share of the global stock market, for splitting stocks. Update once a year."
      title="Countries"
      onSave={(items) => onSave({ section: 'countries', items })}
    />
  );
}

/** Saves on change: one fund's target is sent with every other fund's current one. */
export function FundsCard({
  error,
  onSave,
  saving,
  view,
}: CardProps & { view: TargetSettingsView }) {
  const shownKey = (f: TargetSettingsView['funds'][number]) => {
    const key = targetKey(f.classId ?? '', f.regionId);
    return view.final.some((t) => t.key === key) ? key : '';
  };
  const assign = (securityId: string, key: string) =>
    onSave({
      section: 'funds',
      // Every fund is sent as its select shows it, so a half-assigned fund goes as Not counted.
      items: view.funds.map((f) => {
        const target = view.final.find(
          (t) => t.key === (f.securityId === securityId ? key : shownKey(f))
        );
        return {
          securityId: f.securityId,
          classId: target?.classId ?? null,
          regionId: target?.regionId ?? null,
        };
      }),
    });
  return (
    <CardShell subtitle="Which target each fund you hold counts toward." title="Funds">
      <table className="w-full">
        <TableHead
          columns={[
            { label: 'Fund' },
            { label: 'Held in' },
            { label: 'Value', right: true },
            { label: 'Counts toward' },
          ]}
        />
        <tbody>
          {view.funds.map((f) => (
            <tr key={f.securityId}>
              <td className={TD}>
                <div className="font-mono text-[13px] text-[var(--text-primary)]">{f.label}</div>
                <div className="text-[11.5px] text-[var(--text-muted)]">{f.name}</div>
              </td>
              <td className={`${TD} text-[12.5px] text-[var(--text-secondary)]`}>
                {f.heldIn.join(', ')}
              </td>
              <td className={MONO_CELL}>
                {fmtMoney(f.valueBase, { currency: view.baseCurrency })}
              </td>
              <td className={TD}>
                <Select
                  aria-label={`Target for ${f.label}`}
                  className="h-9"
                  disabled={saving}
                  value={shownKey(f)}
                  onChange={(e) => assign(f.securityId, e.target.value)}
                >
                  <option value="">Not counted</option>
                  {view.final.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.className ? `${t.className} · ${t.name}` : t.name}
                    </option>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
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
                {fmtMoney(a.valueBase, { currency: view.baseCurrency })}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className={ERROR}>{error}</p>}
    </CardShell>
  );
}
