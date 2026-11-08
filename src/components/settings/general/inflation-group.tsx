'use client';

import { HoverSparkline } from '@/components/ui/hover-sparkline';
import { FlagPill } from '@/components/investments/pills';
import { fmtPct } from '@/components/investments/format';
import { MINUS } from '@/lib/currency';
import { fmtMoment } from '@/lib/dates';
import type { PriceIndexResponse } from '@/lib/price-index/api';
import { fmtMonth } from '@/lib/price-index/months';
import { IndexSeries } from '@/lib/price-index/series';
import { REGION_NAMES, type IndexRegion } from '@/lib/price-index/types';
import { cn } from '@/lib/cn';
import { DetailTable, ExpandableRow, ExpandableRowHeader } from './expandable-row';
import { SettingsFooter, SettingsGroup } from './settings-group';

type RegionIndex = PriceIndexResponse['regions'][number];

const MONTHS_SHOWN = 12;
const COLUMNS =
  'grid grid-cols-[1fr_72px_64px] items-center gap-[18px] sm:grid-cols-[140px_84px_1fr_80px]';
const SPARK_CELL = 'hidden sm:block';

export const indexRowKey = (region: IndexRegion) => `index:${region}`;

/** `2.9%`, `−0.3%`; `—` when unknown. */
const fmtAnnual = (v: number | null): string => {
  if (v === null) return '—';
  const rounded = Number(v.toFixed(1));
  return `${rounded < 0 ? MINUS : ''}${Math.abs(rounded).toFixed(1)}%`;
};

/** Each region's consumer prices, with the radio choosing the one Reports adjusts by. */
export function InflationGroup({
  regions,
  saved,
  chosen,
  onChoose,
  openRow,
  onToggleRow,
}: {
  regions: RegionIndex[];
  saved: IndexRegion;
  chosen: IndexRegion;
  onChoose: (region: IndexRegion) => void;
  openRow: string | null;
  onToggleRow: (key: string) => void;
}) {
  return (
    <SettingsGroup caption="Inflation">
      <ExpandableRowHeader
        leading
        cells={
          <div className={COLUMNS}>
            <span>Consumer prices</span>
            <span className="text-right">Annual</span>
            <span className={SPARK_CELL}>Past year</span>
            <span className="text-right">Latest</span>
          </div>
        }
      />
      {regions.map((r) => (
        <IndexRow
          key={r.region}
          chosen={chosen === r.region}
          inUse={saved === r.region}
          index={r}
          open={openRow === indexRowKey(r.region)}
          onChoose={() => onChoose(r.region)}
          onToggle={() => onToggleRow(indexRowKey(r.region))}
        />
      ))}
      <SettingsFooter>
        Selected index is used by Reports&apos; inflation-adjusted view · fetched monthly
      </SettingsFooter>
    </SettingsGroup>
  );
}

function IndexRow({
  index,
  chosen,
  inUse,
  open,
  onChoose,
  onToggle,
}: {
  index: RegionIndex;
  chosen: boolean;
  inUse: boolean;
  open: boolean;
  onChoose: () => void;
  onToggle: () => void;
}) {
  const name = REGION_NAMES[index.region];
  const series = IndexSeries.of(index.months);
  const latest = series.latest();
  const rows = series.recent(MONTHS_SHOWN);
  const points = [...rows]
    .reverse()
    .flatMap((r) =>
      r.annual === null ? [] : [{ label: fmtMonth(r.month, 'short'), value: r.annual }]
    );
  const fetched = index.fetchedAt
    ? ` · fetched ${fmtMoment(index.fetchedAt, { month: 'short', day: 'numeric', hour: undefined, minute: undefined })}`
    : '';

  return (
    <ExpandableRow
      cells={
        <div className={COLUMNS}>
          <div>
            <span>{name}</span>
            {inUse && <FlagPill>In use</FlagPill>}
          </div>
          {latest ? (
            <>
              <div className="text-right font-mono text-[15px] tabular-nums">
                {fmtAnnual(series.annualChange(latest.month))}
              </div>
              <div className={SPARK_CELL}>
                <HoverSparkline
                  format={(v) => `${fmtAnnual(v)} annual`}
                  label="Past year"
                  points={points}
                />
              </div>
              <div className="text-right text-xs text-[var(--text-muted)]">
                {fmtMonth(latest.month, 'short')}
              </div>
            </>
          ) : (
            <div className="col-span-2 text-xs text-[var(--text-muted)] sm:col-span-3">
              Not fetched yet
            </div>
          )}
        </div>
      }
      detail={
        <DetailTable
          columns={['Month', 'Annual', 'Monthly']}
          note={`Source: ${index.attribution}${fetched}`}
          rows={rows.map((r) => ({
            key: r.month,
            cells: [
              fmtMonth(r.month, 'short'),
              fmtAnnual(r.annual),
              r.monthly === null ? '—' : fmtPct(r.monthly),
            ],
          }))}
        />
      }
      leading={<IndexRadio checked={chosen} name={name} onChoose={onChoose} />}
      open={open}
      onToggle={onToggle}
    />
  );
}

function IndexRadio({
  checked,
  name,
  onChoose,
}: {
  checked: boolean;
  name: string;
  onChoose: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={`Use ${name} for Reports' inflation-adjusted view`}
      className="group flex h-4 w-4 items-center justify-center"
      role="radio"
      title="Use for Reports' inflation-adjusted view"
      type="button"
      onClick={onChoose}
    >
      <i
        className={cn(
          'block h-[15px] w-[15px] rounded-full transition-[border] duration-100',
          checked
            ? 'border-[4.5px] border-[var(--accent)]'
            : 'border-[1.5px] border-[var(--text-muted)] group-hover:border-[var(--text-secondary)]'
        )}
      />
    </button>
  );
}
