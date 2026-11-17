'use client';

import { useState } from 'react';
import type { FinalTarget } from '@/lib/investments/targets/allocation';
import type { TargetChange } from '@/lib/investments/targets/settings';
import {
  AddRow,
  BuyWithSelect,
  CardShell,
  Dot,
  HINT_TEXT,
  MONO,
  NameInput,
  PctInput,
  RemoveButton,
  TH,
  TotalPill,
  fraction,
  type BuyOption,
  type Draft,
} from './targets-kit';

type Items<S extends TargetChange['section']> = Extract<TargetChange, { section: S }>['items'];

export type ClassItem = Items<'classes'>[number];
export type RegionItem = Items<'regions'>[number];
export type CountryItem = Items<'countries'>[number];

const SCROLL = 'overflow-x-auto';
const CLASS_GRID =
  'grid min-w-[380px] grid-cols-[minmax(110px,1fr)_76px_minmax(120px,150px)_28px] items-center gap-x-3';
const REGION_GRID =
  'grid min-w-[540px] grid-cols-[16px_minmax(150px,1fr)_62px_72px_58px_minmax(84px,104px)_28px] items-center gap-x-3';
const ROW = 'min-h-9 py-[3px]';

export function ClassesCard({
  buyOptions,
  colorOf,
  draft,
}: {
  buyOptions: BuyOption[];
  /** The colour of a class's target, by the class row's key. */
  colorOf: (classKey: string) => string;
  draft: Draft<ClassItem>;
}) {
  return (
    <CardShell
      collapseKey="classes"
      pill={<TotalPill total={draft.rows.reduce((s, r) => s + r.pct, 0)} />}
      subtitle="How everything counted is split. Set one to 0 when you don’t hold it."
      title="Asset classes"
    >
      <div className={SCROLL}>
        <div className={CLASS_GRID}>
          <div className={TH}>Class</div>
          <div className={`${TH} text-right`}>Target</div>
          <div className={TH}>Buy with</div>
          <div />
        </div>
        {draft.rows.map((r) => (
          <div key={r.key} className={`${CLASS_GRID} ${ROW}`}>
            <div className="flex min-w-0 items-center gap-2">
              <Dot color={colorOf(r.key)} />
              <NameInput
                label="Class name"
                value={r.name}
                onChange={(name) => draft.patch(r.key, { name })}
              />
            </div>
            <PctInput
              label={`Target for ${r.name}`}
              value={r.pct}
              onChange={(pct) => draft.patch(r.key, { pct })}
            />
            {r.splitByRegion ? (
              <span className={HINT_TEXT}>Split by region</span>
            ) : (
              <BuyWithSelect
                label={`Buy with for ${r.name}`}
                options={buyOptions}
                value={r.buySecurityId}
                onChange={(buySecurityId) => draft.patch(r.key, { buySecurityId })}
              />
            )}
            {r.splitByRegion ? (
              <span />
            ) : (
              <RemoveButton label={`Remove ${r.name}`} onClick={() => draft.remove(r.key)} />
            )}
          </div>
        ))}
      </div>
      <AddRow
        label="+ Add class"
        onClick={() =>
          draft.add({ name: 'New class', pct: 0, splitByRegion: false, buySecurityId: null })
        }
      />
    </CardShell>
  );
}

/** Regions of the split class, each opening to the countries that make up its market weight. */
export function RegionsCard({
  buyOptions,
  colorOf,
  countries,
  countryTotal,
  draft,
  final,
  split,
}: {
  buyOptions: BuyOption[];
  /** The colour of a region's target, by the region row's key. */
  colorOf: (regionKey: string) => string;
  countries: Draft<CountryItem>;
  countryTotal: number;
  draft: Draft<RegionItem>;
  /** The live targets, with draft row keys standing in for ids. */
  final: FinalTarget[];
  split: { name: string; pct: number } | undefined;
}) {
  // By position, so a new region stays open when saving swaps its draft key for an id.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (key: number) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const name = split?.name ?? 'Stocks';
  return (
    <CardShell
      collapseKey="regions"
      pill={<TotalPill quiet label="Countries" total={countryTotal} />}
      subtitle={`Splits the ${name} ${split?.pct ?? 0}%. A region’s market weight is the sum of its countries; tilt raises or lowers it.`}
      title={`${name} by region`}
    >
      <div className={SCROLL}>
        <div className={REGION_GRID}>
          <div />
          <div className={TH}>Region</div>
          <div className={`${TH} text-right`}>Market</div>
          <div className={`${TH} text-right`}>Tilt</div>
          <div className={`${TH} text-right`}>Overall</div>
          <div className={TH}>Buy with</div>
          <div />
        </div>
        {draft.rows.map((r, index) => {
          const target = final.find((t) => t.regionId === r.key);
          const own = countries.rows.filter((c) => c.regionId === r.key);
          const isOpen = open.has(index);
          return (
            <div key={r.key}>
              <div className={`${REGION_GRID} ${ROW}`}>
                <button
                  aria-expanded={isOpen}
                  aria-label={`Countries in ${r.name}`}
                  className={`grid h-7 place-items-center text-[10px] text-[var(--text-muted)] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${isOpen ? 'rotate-90' : ''}`}
                  type="button"
                  onClick={() => toggle(index)}
                >
                  ▶
                </button>
                <div className="flex min-w-0 items-center gap-2">
                  <Dot color={colorOf(r.key)} />
                  <NameInput
                    label="Region name"
                    value={r.name}
                    onChange={(n) => draft.patch(r.key, { name: n })}
                  />
                </div>
                <div className={`${MONO} text-right text-[var(--text-secondary)]`}>
                  {target?.marketWeightPct != null ? `${target.marketWeightPct.toFixed(2)}%` : '—'}
                </div>
                <PctInput
                  signed
                  label={`Tilt for ${r.name}`}
                  value={r.tiltPct}
                  onChange={(tiltPct) => draft.patch(r.key, { tiltPct })}
                />
                <div className={`${MONO} text-right font-medium text-[var(--text-primary)]`}>
                  {target ? fraction(target.target) : '—'}
                </div>
                <BuyWithSelect
                  label={`Buy with for ${r.name}`}
                  options={buyOptions}
                  value={r.buySecurityId}
                  onChange={(buySecurityId) => draft.patch(r.key, { buySecurityId })}
                />
                {own.length ? (
                  <span />
                ) : (
                  <RemoveButton label={`Remove ${r.name}`} onClick={() => draft.remove(r.key)} />
                )}
              </div>
              {isOpen && (
                <div className="mb-2.5 ml-[7px] mt-0.5 grid max-w-[460px] gap-0.5 border-l border-[var(--border-hover)] pl-[21px]">
                  {own.map((c) => (
                    <div
                      key={c.key}
                      className="grid min-h-8 grid-cols-[minmax(0,1fr)_84px_28px] items-center gap-x-3"
                    >
                      <NameInput
                        className="h-7 font-normal"
                        label="Country"
                        value={c.name}
                        onChange={(n) => countries.patch(c.key, { name: n })}
                      />
                      <PctInput
                        label={`Weight for ${c.name}`}
                        value={c.weightPct}
                        onChange={(weightPct) => countries.patch(c.key, { weightPct })}
                      />
                      <RemoveButton
                        label={`Remove ${c.name}`}
                        onClick={() => countries.remove(c.key)}
                      />
                    </div>
                  ))}
                  <AddRow
                    small
                    label="+ Add country"
                    onClick={() =>
                      countries.add({ name: 'New country', weightPct: 0, regionId: r.key })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AddRow
        label="+ Add region"
        onClick={() => draft.add({ name: 'New region', tiltPct: 0, buySecurityId: null })}
      />
      <p className={`${HINT_TEXT} mt-2.5`}>
        {countries.rows.length} countries · open a region to edit its countries.
      </p>
    </CardShell>
  );
}
