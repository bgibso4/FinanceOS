import { z } from 'zod';
import {
  PriceIndexSourceError,
  requestAgency,
  type IndexObservation,
  type IndexRegion,
  type MonthKey,
  type PriceIndexSource,
} from '../types';

const ENDPOINT = 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorByReferencePeriodRange';
const VECTOR_ID = 41690973;

const responseSchema = z
  .array(
    z.object({
      status: z.string(),
      object: z.unknown(),
    })
  )
  .min(1);

const pointsSchema = z.object({
  vectorDataPoint: z.array(z.object({ refPer: z.string(), value: z.number().nullish() })),
});

/** Canadian consumer price index (all items) from Statistics Canada. */
export class StatCanCpiSource implements PriceIndexSource {
  readonly region: IndexRegion = 'CA';
  readonly attribution = 'Statistics Canada, CPI all-items';

  constructor(private readonly http: typeof fetch = fetch) {}

  async fetchMonths(from: MonthKey, to: MonthKey): Promise<IndexObservation[]> {
    const url =
      `${ENDPOINT}?vectorIds="${VECTOR_ID}"` +
      `&startRefPeriod=${from}-01&endReferencePeriod=${to}-01`;
    const res = await requestAgency(this.http, url);
    if (!res.ok) throw new PriceIndexSourceError(`Statistics Canada answered HTTP ${res.status}`);

    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new PriceIndexSourceError('Statistics Canada response was not in the expected shape');
    }
    const [{ status, object }] = parsed.data;
    if (status !== 'SUCCESS') throw new PriceIndexSourceError(`Statistics Canada status ${status}`);

    const points = pointsSchema.safeParse(object);
    if (!points.success) {
      throw new PriceIndexSourceError('Statistics Canada response was not in the expected shape');
    }
    return points.data.vectorDataPoint
      .flatMap((p) =>
        typeof p.value === 'number' && Number.isFinite(p.value)
          ? [{ month: p.refPer.slice(0, 7), value: p.value }]
          : []
      )
      .filter((o) => o.month >= from && o.month <= to)
      .sort((a, b) => a.month.localeCompare(b.month));
  }
}
