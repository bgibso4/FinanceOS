import { z } from 'zod';
import {
  PriceIndexSourceError,
  type IndexObservation,
  type IndexRegion,
  type MonthKey,
  type PriceIndexSource,
} from '../types';

const ENDPOINT = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const SERIES_ID = 'CUUR0000SA0';
const MAX_YEARS = 10;

const statusSchema = z.object({ status: z.string(), message: z.array(z.string()).optional() });

const resultsSchema = z.object({
  Results: z.object({
    series: z.array(
      z.object({
        data: z.array(z.object({ year: z.string(), period: z.string(), value: z.string() })),
      })
    ),
  }),
});

/** US consumer price index (CPI-U, all items) from the Bureau of Labor Statistics. */
export class BlsCpiSource implements PriceIndexSource {
  readonly region: IndexRegion = 'US';
  readonly attribution = 'US Bureau of Labor Statistics, CPI-U all items';

  constructor(private readonly http: typeof fetch = fetch) {}

  async fetchMonths(from: MonthKey, to: MonthKey): Promise<IndexObservation[]> {
    const byMonth = new Map<MonthKey, number>();
    const lastYear = Number(to.slice(0, 4));
    for (let start = Number(from.slice(0, 4)); start <= lastYear; start += MAX_YEARS) {
      const end = Math.min(start + MAX_YEARS - 1, lastYear);
      for (const row of await this.fetchYears(start, end)) {
        if (row.month >= from && row.month <= to) byMonth.set(row.month, row.value);
      }
    }
    return [...byMonth]
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private async fetchYears(startYear: number, endYear: number): Promise<IndexObservation[]> {
    const res = await this.http(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesid: [SERIES_ID],
        startyear: String(startYear),
        endyear: String(endYear),
      }),
    });
    if (!res.ok) throw new PriceIndexSourceError(`BLS answered HTTP ${res.status}`);

    const body: unknown = await res.json();
    const head = statusSchema.safeParse(body);
    if (!head.success)
      throw new PriceIndexSourceError('BLS response was not in the expected shape');
    if (head.data.status !== 'REQUEST_SUCCEEDED') {
      const why = head.data.message?.join(' ');
      throw new PriceIndexSourceError(`BLS status ${head.data.status}${why ? `: ${why}` : ''}`);
    }
    const parsed = resultsSchema.safeParse(body);
    if (!parsed.success)
      throw new PriceIndexSourceError('BLS response was not in the expected shape');

    const rows: IndexObservation[] = [];
    for (const { year, period, value } of parsed.data.Results.series.flatMap((s) => s.data)) {
      const m = /^M(0[1-9]|1[0-2])$/.exec(period);
      const n = Number(value);
      if (!m || !Number.isFinite(n)) continue; // annual averages, and "-" for unpublished months
      rows.push({ month: `${year}-${m[1]}`, value: n });
    }
    return rows;
  }
}
