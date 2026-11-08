import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { HoverSparkline } from '@/components/ui/hover-sparkline';
import { fmtDay, fmtPct, signedTone } from '@/components/investments/format';
import { BASE_CURRENCIES } from '@/lib/currency';
import { fmtMoment, localDay } from '@/lib/dates';
import type { ExchangeRatesResponse } from '@/lib/fx/rate-summary';
import { fmtMonth } from '@/lib/price-index/months';
import { sendJson } from '@/lib/send-json';
import { cn } from '@/lib/cn';
import { ds } from '@/lib/design-system';
import {
  DetailTable,
  ExpandableRow,
  ExpandableRowHeader,
  SPARK_COLUMN,
  SparkCell,
} from './expandable-row';
import { SettingsFooter, SettingsGroup, SettingsRow } from './settings-group';

export type PairRate = ExchangeRatesResponse['rates'][number];

const COLUMNS =
  'grid grid-cols-[1fr_72px_64px] items-center gap-[18px] sm:grid-cols-[150px_84px_1fr_96px]';

export const rateRowKey = (r: PairRate) => `rate:${r.fromCurrency}-${r.toCurrency}`;

export async function fetchRates(): Promise<PairRate[]> {
  const body = await sendJson<ExchangeRatesResponse>('/api/exchange-rates', 'GET');
  return body.rates;
}

/** Base currency, one row per stored exchange-rate pair, and the rate refresh. */
export function CurrencyGroup({
  baseCurrency,
  onBaseCurrencyChange,
  rates,
  onRatesChange,
  openRow,
  onToggleRow,
}: {
  baseCurrency: string;
  onBaseCurrencyChange: (code: string) => void;
  rates: PairRate[];
  onRatesChange: (rates: PairRate[]) => void;
  openRow: string | null;
  onToggleRow: (key: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/exchange-rates/refresh', { method: 'POST' });
      const body = res.ok ? await res.json() : null;
      setRefreshFailed(!body || (body.failed?.length ?? 0) > 0);
    } catch (error) {
      console.error('Failed to refresh exchange rates:', error);
      setRefreshFailed(true);
    }
    try {
      onRatesChange(await fetchRates());
    } catch (error) {
      console.error('Failed to read exchange rates:', error);
    }
    setRefreshing(false);
  };

  const asOf = rates
    .map((r) => r.updatedAt)
    .sort()
    .at(-1);

  return (
    <SettingsGroup caption="Currency">
      <SettingsRow
        control={
          <Select
            aria-label="Base currency"
            className="h-auto w-auto min-w-[200px] py-1.5 text-[13px]"
            value={baseCurrency}
            onChange={(e) => onBaseCurrencyChange(e.target.value)}
          >
            {BASE_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {`${c.code} · ${c.name}`}
              </option>
            ))}
          </Select>
        }
        description="Totals, analytics and reports show in this currency"
        label="Base currency"
      />
      {rates.length === 0 ? (
        <div className="border-t border-[var(--border)] px-[18px] py-3 text-[13px] text-[var(--text-muted)]">
          No exchange rates yet
        </div>
      ) : (
        <>
          <ExpandableRowHeader
            cells={
              <div className={COLUMNS}>
                <span>Exchange rate</span>
                <span className="text-right">Today</span>
                <span className={SPARK_COLUMN}>Past year</span>
                <span className="text-right">1y change</span>
              </div>
            }
          />
          {rates.map((r) => (
            <RateRow
              key={rateRowKey(r)}
              open={openRow === rateRowKey(r)}
              rate={r}
              onToggle={() => onToggleRow(rateRowKey(r))}
            />
          ))}
        </>
      )}
      <SettingsFooter
        action={
          <Button
            className="px-2 py-1 text-xs"
            disabled={refreshing}
            variant="ghost"
            onClick={refresh}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      >
        <div>
          {asOf ? `Updated automatically · as of ${fmtMoment(asOf)}` : 'Updated automatically'}
        </div>
        {refreshFailed && (
          <div className={ds.status.warning.text}>
            Couldn&apos;t refresh the rate — showing the last one
          </div>
        )}
      </SettingsFooter>
    </SettingsGroup>
  );
}

function RateRow({
  rate: r,
  open,
  onToggle,
}: {
  rate: PairRate;
  open: boolean;
  onToggle: () => void;
}) {
  const change = r.yearAgoRate ? (r.rate / r.yearAgoRate - 1) * 100 : null;
  const thisMonth = localDay().slice(0, 7);
  return (
    <ExpandableRow
      cells={
        <div className={COLUMNS}>
          <div>
            <span className="font-mono">{`1 ${r.fromCurrency}`}</span>{' '}
            <span className="text-[var(--text-muted)]">{`→ ${r.toCurrency}`}</span>
          </div>
          <div className="text-right font-mono text-[15px] tabular-nums">{r.rate.toFixed(4)}</div>
          <SparkCell>
            <HoverSparkline
              format={(v) => `1 ${r.fromCurrency} = ${v.toFixed(4)} ${r.toCurrency}`}
              label="Past year"
              points={r.weekly.map((w) => ({ label: fmtDay(w.day), value: w.rate }))}
            />
          </SparkCell>
          <div className={cn('text-right font-mono text-xs tabular-nums', signedTone(change))}>
            {change === null ? '—' : fmtPct(change)}
          </div>
        </div>
      }
      detail={
        <DetailTable
          columns={['Month', 'Rate at month end']}
          note="Every day's rate is stored; each amount converts at its own day's rate."
          rows={r.monthEnds.map((m) => ({
            key: m.month,
            cells: [
              `${fmtMonth(m.month, 'short')}${m.month === thisMonth ? ' (so far)' : ''}`,
              m.rate.toFixed(4),
            ],
          }))}
        />
      }
      open={open}
      onToggle={onToggle}
    />
  );
}
