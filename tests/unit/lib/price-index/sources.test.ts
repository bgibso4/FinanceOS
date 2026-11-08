import { describe, it, expect } from 'vitest';
import blsFixture from '../../../fixtures/price-index/bls-cpi.json';
import statcanFixture from '../../../fixtures/price-index/statcan-cpi.json';
import { PriceIndexSourceError } from '@/lib/price-index/types';
import { BlsCpiSource } from '@/lib/price-index/sources/bls';
import { StatCanCpiSource } from '@/lib/price-index/sources/statcan';

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeHttp(body: unknown, status = 200) {
  const calls: Call[] = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { http, calls };
}

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body));

describe('BlsCpiSource', () => {
  it('blsParsesMonths', async () => {
    const { http } = fakeHttp(blsFixture);
    const rows = await new BlsCpiSource(http).fetchMonths('2025-09', '2026-09');
    expect(rows).toContainEqual({ month: '2026-09', value: 336.94 });
    expect(rows.map((r) => r.month)).toEqual(['2025-09', '2025-11', '2026-08', '2026-09']);
  });

  it('blsSkipsDashMonths', async () => {
    const { http } = fakeHttp(blsFixture);
    const rows = await new BlsCpiSource(http).fetchMonths('2025-09', '2026-09');
    expect(rows.map((r) => r.month)).not.toContain('2025-10');
  });

  it('blsRequestsYears', async () => {
    const { http, calls } = fakeHttp(blsFixture);
    await new BlsCpiSource(http).fetchMonths('2025-09', '2026-09');
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toMatchObject({
      seriesid: ['CUUR0000SA0'],
      startyear: '2025',
      endyear: '2026',
    });
  });

  it('blsSplitsLongRanges', async () => {
    const { http, calls } = fakeHttp(blsFixture);
    await new BlsCpiSource(http).fetchMonths('2010-01', '2026-09');
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const b = bodyOf(c);
      expect(Number(b.endyear) - Number(b.startyear) + 1).toBeLessThanOrEqual(10);
    }
  });

  it('blsErrorStatusThrows', async () => {
    const { http } = fakeHttp({ status: 'REQUEST_NOT_PROCESSED', message: ['limit'], Results: {} });
    await expect(new BlsCpiSource(http).fetchMonths('2025-09', '2026-09')).rejects.toBeInstanceOf(
      PriceIndexSourceError
    );
  });

  it('blsIgnoresOutOfRange', async () => {
    const { http } = fakeHttp({
      status: 'REQUEST_SUCCEEDED',
      Results: {
        series: [
          {
            data: [
              { year: '2026', period: 'M09', value: '3' },
              { year: '2026', period: 'M13', value: '9' },
              { year: '2026', period: 'S01', value: '9' },
              { year: '2025', period: 'M08', value: '1' },
              { year: '2025', period: 'M09', value: '2' },
            ],
          },
        ],
      },
    });
    const rows = await new BlsCpiSource(http).fetchMonths('2025-09', '2026-08');
    expect(rows).toEqual([{ month: '2025-09', value: 2 }]);
  });

  it('httpErrorThrows', async () => {
    const { http } = fakeHttp({}, 503);
    await expect(new BlsCpiSource(http).fetchMonths('2025-09', '2026-09')).rejects.toBeInstanceOf(
      PriceIndexSourceError
    );
  });

  it('blsSchemaMismatchThrows', async () => {
    const { http } = fakeHttp({ status: 'REQUEST_SUCCEEDED', Results: {} });
    await expect(new BlsCpiSource(http).fetchMonths('2025-09', '2026-09')).rejects.toBeInstanceOf(
      PriceIndexSourceError
    );
  });

  it('identifies its region and attribution', () => {
    const s = new BlsCpiSource(fakeHttp({}).http);
    expect(s.region).toBe('US');
    expect(s.attribution).toBe('US Bureau of Labor Statistics, CPI-U all items');
  });
});

describe('StatCanCpiSource', () => {
  it('statcanParsesMonths', async () => {
    const { http } = fakeHttp(statcanFixture);
    const rows = await new StatCanCpiSource(http).fetchMonths('2025-09', '2026-09');
    expect(rows).toEqual([
      { month: '2026-08', value: 169.8 },
      { month: '2026-09', value: 170 },
    ]);
  });

  it('statcanRequestsRange', async () => {
    const { http, calls } = fakeHttp(statcanFixture);
    await new StatCanCpiSource(http).fetchMonths('2025-09', '2026-09');
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain('getDataFromVectorByReferencePeriodRange');
    expect(url).toContain('vectorIds="41690973"');
    expect(url).toContain('startRefPeriod=2025-09-01');
    expect(url).toContain('endReferencePeriod=2026-09-01');
  });

  it('statcanErrorStatusThrows', async () => {
    const { http } = fakeHttp([{ status: 'FAILED', object: 'bad' }]);
    await expect(
      new StatCanCpiSource(http).fetchMonths('2025-09', '2026-09')
    ).rejects.toBeInstanceOf(PriceIndexSourceError);
  });

  it('httpErrorThrows', async () => {
    const { http } = fakeHttp({}, 503);
    await expect(
      new StatCanCpiSource(http).fetchMonths('2025-09', '2026-09')
    ).rejects.toBeInstanceOf(PriceIndexSourceError);
  });

  it('statcanSchemaMismatchThrows', async () => {
    const { http } = fakeHttp([{ status: 'SUCCESS', object: {} }]);
    await expect(
      new StatCanCpiSource(http).fetchMonths('2025-09', '2026-09')
    ).rejects.toBeInstanceOf(PriceIndexSourceError);
  });

  it('identifies its region and attribution', () => {
    const s = new StatCanCpiSource(fakeHttp({}).http);
    expect(s.region).toBe('CA');
    expect(s.attribution).toBe('Statistics Canada, CPI all-items');
  });
});
