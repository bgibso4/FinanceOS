'use client';

import { useEffect, useMemo, useState } from 'react';
import { SaveBar } from '@/components/settings/general/save-bar';
import { triggerSync } from '@/lib/cloud-sync';
import { Pricing } from '@/lib/investments/codes';
import type { SecurityList } from '@/lib/investments/security-list';
import { finalTargets, targetKey, targetTotals } from '@/lib/investments/targets/allocation';
import type { TargetChange, TargetSettingsView } from '@/lib/investments/targets/settings';
import { errorText, sendJson } from './editor-kit';
import {
  ClassesCard,
  RegionsCard,
  type ClassItem,
  type CountryItem,
  type RegionItem,
} from './targets-cards';
import { AccountsCard, FundsCard, SummaryCard } from './targets-counts';
import { segmentColor, useDraft, type BuyOption } from './targets-kit';

const NONE: never[] = [];

type Section = TargetChange['section'];
type Fund = TargetSettingsView['funds'][number];

/** Sections in the order they are saved: a later one can point at rows an earlier one creates. */
const SECTION_LABEL: Record<Section, string> = {
  classes: 'Asset classes',
  regions: 'Regions',
  countries: 'Countries',
  funds: 'Funds',
  accounts: 'Accounts',
};

const COLUMN_TITLE =
  'mb-[-6px] ml-0.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]';

/**
 * Settings → Investing Targets. Every edit on the tab is a draft; one bar at the bottom of the
 * window saves or discards them all.
 */
export function TargetsTab() {
  const [view, setView] = useState<TargetSettingsView | null>(null);
  const [buyOptions, setBuyOptions] = useState<BuyOption[]>([]);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const classes = useDraft<ClassItem>(view?.classes ?? NONE);
  const regions = useDraft<RegionItem>(view?.regions ?? NONE);
  const countries = useDraft<CountryItem>(view?.countries ?? NONE);
  /** Unsaved fund targets, by security id; a new row's key stands in for its id. */
  const [fundEdits, setFundEdits] = useState<Record<string, string>>({});
  const [accountEdits, setAccountEdits] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [targets, securities] = await Promise.all([
          sendJson<TargetSettingsView>('/api/investments/targets', 'GET'),
          sendJson<SecurityList>('/api/investments/securities', 'GET'),
        ]);
        if (!live) return;
        setView(targets);
        setBuyOptions(
          securities.securities
            .filter((s) => s.pricing === Pricing.Market)
            .map((s) => ({ id: s.id, label: s.label }))
        );
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // The targets as the drafts stand; row keys stand in for the ids of unsaved rows.
  const setup = useMemo(
    () => ({
      classes: classes.rows.map((r) => ({ ...r, id: r.key })),
      regions: regions.rows.map((r) => ({ ...r, id: r.key })),
      countries: countries.rows,
    }),
    [classes.rows, regions.rows, countries.rows]
  );
  const final = useMemo(() => finalTargets(setup), [setup]);

  if (failed) {
    return (
      <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
        Couldn’t load your investing targets.
      </p>
    );
  }
  if (!view) {
    return <p className="py-6 text-center text-sm text-[var(--text-secondary)]">Loading…</p>;
  }

  const savedKey = (f: Fund) => targetKey(f.classId ?? '', f.regionId);
  // A fund pointing at a target that is not there shows, and saves, as Not counted.
  const shownKey = (f: Fund) => {
    const key = fundEdits[f.securityId] ?? savedKey(f);
    return final.some((t) => t.key === key) ? key : '';
  };
  const isTicked = (id: string) =>
    accountEdits[id] ?? view.accounts.find((a) => a.id === id)?.inTargets ?? false;

  const dirty: Record<Section, boolean> = {
    classes: classes.dirty,
    regions: regions.dirty,
    countries: countries.dirty,
    funds: view.funds.some(
      (f) => shownKey(f) !== (view.final.some((t) => t.key === savedKey(f)) ? savedKey(f) : '')
    ),
    accounts: view.accounts.some((a) => isTicked(a.id) !== a.inTargets),
  };
  const changed = (Object.keys(SECTION_LABEL) as Section[]).filter((s) => dirty[s]);

  const colorOf = (key: string) => segmentColor(final.findIndex((t) => t.key === key));
  const classColor = (classKey: string) =>
    segmentColor(final.findIndex((t) => t.classId === classKey));
  const regionColor = (regionKey: string) =>
    segmentColor(final.findIndex((t) => t.regionId === regionKey));

  const discard = () => {
    classes.reset();
    regions.reset();
    countries.reset();
    setFundEdits({});
    setAccountEdits({});
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    /** Saved ids of rows that were new when Save was pressed, by their draft key. */
    const ids = new Map<string, string>();
    const real = (key: string) => ids.get(key) ?? key;
    const learn = (rows: { key: string }[], saved: { id: string }[]) =>
      rows.forEach((r, i) => saved[i] && ids.set(r.key, saved[i].id));
    const fundTargets = view.funds.map((f) => ({
      securityId: f.securityId,
      target: final.find((t) => t.key === shownKey(f)),
    }));
    const steps: Record<
      Section,
      { change: () => TargetChange; done: (v: TargetSettingsView) => void }
    > = {
      classes: {
        change: () => ({ section: 'classes', items: classes.items() }),
        done: (v) => {
          learn(classes.rows, v.classes);
          classes.reset();
        },
      },
      regions: {
        change: () => ({ section: 'regions', items: regions.items() }),
        done: (v) => {
          learn(regions.rows, v.regions);
          regions.reset();
        },
      },
      countries: {
        change: () => ({
          section: 'countries',
          items: countries.items().map((c) => ({ ...c, regionId: real(c.regionId) })),
        }),
        done: () => countries.reset(),
      },
      funds: {
        change: () => ({
          section: 'funds',
          items: fundTargets.map(({ securityId, target }) => ({
            securityId,
            classId: target ? real(target.classId) : null,
            regionId: target?.regionId ? real(target.regionId) : null,
          })),
        }),
        done: () => setFundEdits({}),
      },
      accounts: {
        change: () => ({
          section: 'accounts',
          items: view.accounts.map((a) => ({ accountId: a.id, inTargets: isTicked(a.id) })),
        }),
        done: () => setAccountEdits({}),
      },
    };
    let wrote = false;
    let section: Section = 'classes';
    try {
      for (section of changed) {
        const next = await sendJson<TargetSettingsView>(
          '/api/investments/targets',
          'PUT',
          steps[section].change()
        );
        wrote = true;
        setView(next);
        steps[section].done(next);
      }
    } catch (e) {
      setError(`${SECTION_LABEL[section]}: ${errorText(e)}`);
      // Sections saved before the failure gave new rows real ids; point what is left at them.
      countries.map((c) => ({ ...c, regionId: real(c.regionId) }));
      setFundEdits((edits) =>
        Object.fromEntries(
          Object.entries(edits).map(([id, key]) => [id, key.split(':').map(real).join(':')])
        )
      );
    } finally {
      setSaving(false);
      if (wrote) triggerSync();
    }
  };

  const split = classes.rows.find((c) => c.splitByRegion);
  return (
    <div className="max-w-[1320px] space-y-4 pb-24">
      <SummaryCard
        accounts={view.accounts}
        buyOptions={buyOptions}
        colorOf={colorOf}
        currency={view.baseCurrency}
        final={final}
        isTicked={isTicked}
      />
      <div className="grid items-start gap-4 min-[1100px]:grid-cols-2">
        <div className="grid min-w-0 gap-4">
          <p className={COLUMN_TITLE}>Targets</p>
          <ClassesCard buyOptions={buyOptions} colorOf={classColor} draft={classes} />
          <RegionsCard
            buyOptions={buyOptions}
            colorOf={regionColor}
            countries={countries}
            countryTotal={targetTotals(setup).countryWeightPct}
            draft={regions}
            final={final}
            split={split}
          />
        </div>
        <div className="grid min-w-0 gap-4">
          <p className={COLUMN_TITLE}>What counts</p>
          <AccountsCard
            accounts={view.accounts}
            currency={view.baseCurrency}
            isTicked={isTicked}
            onToggle={(id, ticked) => setAccountEdits((e) => ({ ...e, [id]: ticked }))}
          />
          <FundsCard
            accounts={view.accounts}
            currency={view.baseCurrency}
            final={final}
            funds={view.funds}
            isTicked={isTicked}
            shownKey={shownKey}
            onAssign={(id, key) => setFundEdits((e) => ({ ...e, [id]: key }))}
          />
        </div>
      </div>
      {changed.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[18px]">
          <SaveBar
            className="pointer-events-auto w-full max-w-[760px]"
            error={error}
            message={`Unsaved changes: ${changed.map((s) => SECTION_LABEL[s]).join(', ')}`}
            saving={saving}
            onDiscard={discard}
            onSave={save}
          />
        </div>
      )}
    </div>
  );
}
