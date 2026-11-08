import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeneralSettings } from '@/components/settings/general/general-settings';
import { MONTHLY_TIP } from '@/components/settings/general/inflation-group';

// Local times, so the expected text does not depend on the machine's zone.
const at = (h: number, m: number) => new Date(2026, 10, 8, h, m).toISOString();

const rate = (updatedAt: string, yearAgoRate: number | null) => ({
  fromCurrency: 'CAD',
  toCurrency: 'USD',
  rate: 0.7046,
  date: '2026-11-08T00:00:00.000Z',
  updatedAt,
  yearAgoRate,
  weekly: [
    { day: '2026-09-18', rate: 0.7 },
    { day: '2026-11-06', rate: 0.7046 },
  ],
  monthEnds: [
    { month: '2026-11', rate: 0.7046 },
    { month: '2026-10', rate: 0.715 },
  ],
});

// 2025-09 … 2026-08 rise 0.2 a month from 100; 2026-09 is 102.9, so its annual change is 2.9%.
const US_MONTHS = [
  ...Array.from({ length: 12 }, (_, i) => ({
    month: `${2025 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, '0')}`,
    value: 100 + i * 0.2,
  })),
  { month: '2026-09', value: 102.9 },
];

type Server = {
  settings: { baseCurrency: string; inflationRegion: string };
  caMonths: { month: string; value: number }[];
  updatedAt: string;
  patchError: string | null;
  refreshFails: boolean;
  yearAgoRate: number | null;
  /** GET URLs answering 500. */
  failing: string[];
};
let server: Server;
let calls: { url: string; method: string; body?: unknown }[];

function stub() {
  calls = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
    if (method === 'GET' && server.failing.includes(u)) {
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response;
    }
    if (u === '/api/settings' && method === 'PATCH') {
      if (server.patchError) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: server.patchError }),
        } as Response;
      }
      server.settings = { ...server.settings, ...body };
      return ok({ settings: { id: 's1', ...server.settings } });
    }
    if (u === '/api/settings') return ok({ settings: { id: 's1', ...server.settings } });
    if (u === '/api/exchange-rates')
      return ok({ rates: [rate(server.updatedAt, server.yearAgoRate)] });
    if (u === '/api/exchange-rates/refresh') {
      if (server.refreshFails)
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      server.updatedAt = at(9, 5);
      return ok({ pairs: 1, days: 1, failed: [] });
    }
    if (u === '/api/price-index') {
      return ok({
        selected: server.settings.inflationRegion,
        regions: [
          {
            region: 'US',
            name: 'US',
            attribution: 'US Bureau of Labor Statistics, CPI-U all items',
            fetchedAt: at(7, 0),
            months: US_MONTHS,
          },
          {
            region: 'CA',
            name: 'Canada',
            attribution: 'Statistics Canada, CPI all-items',
            fetchedAt: server.caMonths.length ? at(7, 0) : null,
            months: server.caMonths,
          },
        ],
      });
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 8, 12, 0));
  server = {
    settings: { baseCurrency: 'USD', inflationRegion: 'US' },
    caMonths: [
      { month: '2025-09', value: 160 },
      { month: '2026-09', value: 163.36 },
    ],
    updatedAt: at(7, 20),
    patchError: null,
    refreshFails: false,
    yearAgoRate: 0.7096,
    failing: [],
  };
  stub();
});

afterEach(() => {
  vi.useRealTimers();
});

const rowOf = (text: string) => screen.getByText(text).closest('[role="button"]') as HTMLElement;
const saveBar = () => screen.queryByRole('button', { name: 'Save changes' });

async function setup() {
  const onSaved = vi.fn();
  const view = render(<GeneralSettings onSaved={onSaved} />);
  await screen.findByText('1 CAD');
  return { onSaved, ...view };
}

describe('GeneralSettings', () => {
  it('showsRateRowWithChange', async () => {
    await setup();
    const row = rowOf('1 CAD');
    expect(within(row).getByText('→ USD')).toBeInTheDocument();
    expect(within(row).getByText('0.7046')).toBeInTheDocument();
    const change = within(row).getByText('−0.7%');
    expect(change.className).toContain('text-[var(--red)]');
    expect(screen.getByText('Updated automatically · as of 7:20 am')).toBeInTheDocument();
  });

  it('showsInflationRowsWithLatest', async () => {
    await setup();
    const us = rowOf('US');
    expect(within(us).getByText('2.9%')).toBeInTheDocument();
    expect(within(us).getByText('Sep 2026')).toBeInTheDocument();
    expect(within(us).getByText('In use')).toBeInTheDocument();
    const ca = rowOf('Canada');
    expect(within(ca).getByText('2.1%')).toBeInTheDocument();
    expect(within(ca).queryByText('In use')).toBeNull();
    expect(screen.getByRole('radio', { name: /US/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('rowClickOpensTable', async () => {
    await setup();
    await userEvent.click(rowOf('1 CAD'));
    expect(rowOf('1 CAD')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Rate at month end')).toBeInTheDocument();
    expect(screen.getByText('Nov 2026 (so far)')).toBeInTheDocument();
    expect(screen.getByText('Oct 2026')).toBeInTheDocument();

    await userEvent.click(rowOf('US'));
    expect(rowOf('1 CAD')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Rate at month end')).toBeNull();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('+0.7%')).toBeInTheDocument(); // Sep 2026 vs Aug 2026
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // Aug 2026 has no year-earlier month
    expect(
      screen.getByText('Source: US Bureau of Labor Statistics, CPI-U all items · fetched Nov 8')
    ).toBeInTheDocument();
  });

  it('explainsTheMonthlyColumnOnHover', async () => {
    await setup();
    await userEvent.click(rowOf('US'));
    await userEvent.hover(screen.getByText('Monthly'));
    expect(screen.getByRole('tooltip')).toHaveTextContent(MONTHLY_TIP);
  });

  it('radioDoesNotToggleTable', async () => {
    await setup();
    await userEvent.click(screen.getByRole('radio', { name: /Canada/ }));
    expect(rowOf('Canada')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('radio', { name: /Canada/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('radioShowsSaveBarInUseStays', async () => {
    await setup();
    expect(saveBar()).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /Canada/ }));
    expect(screen.getByText('Reports adjusts by Canada inflation')).toBeInTheDocument();
    expect(saveBar()).toBeInTheDocument();
    expect(within(rowOf('US')).getByText('In use')).toBeInTheDocument();
  });

  it('discardRestores', async () => {
    await setup();
    await userEvent.selectOptions(screen.getByLabelText('Base currency'), 'CAD');
    await userEvent.click(screen.getByRole('radio', { name: /Canada/ }));
    expect(
      screen.getByText('Base currency → CAD · Reports adjusts by Canada inflation')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Base currency')).toHaveValue('USD');
    expect(screen.getByRole('radio', { name: /US/ })).toHaveAttribute('aria-checked', 'true');
    expect(saveBar()).toBeNull();
  });

  it('saveSendsBothAndHidesBar', async () => {
    const { onSaved } = await setup();
    await userEvent.selectOptions(screen.getByLabelText('Base currency'), 'CAD');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls).toContainEqual({
      url: '/api/settings',
      method: 'PATCH',
      body: { baseCurrency: 'CAD', inflationRegion: 'US' },
    });
    expect(saveBar()).toBeNull();
    expect(screen.getByLabelText('Base currency')).toHaveValue('CAD');
  });

  it('saveFailureKeepsBar', async () => {
    server.patchError = 'Invalid base currency';
    const { onSaved } = await setup();
    await userEvent.click(screen.getByRole('radio', { name: /Canada/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Invalid base currency')).toBeInTheDocument();
    expect(saveBar()).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(within(rowOf('US')).getByText('In use')).toBeInTheDocument();
  });

  it('remountShowsSavedValues', async () => {
    const { unmount } = await setup();
    await userEvent.click(screen.getByRole('radio', { name: /Canada/ }));
    await userEvent.selectOptions(screen.getByLabelText('Base currency'), 'EUR');
    unmount();
    await setup();
    expect(screen.getByRole('radio', { name: /US/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Base currency')).toHaveValue('USD');
    expect(saveBar()).toBeNull();
  });

  it('notFetchedYet', async () => {
    server.caMonths = [];
    await setup();
    const ca = rowOf('Canada');
    expect(within(ca).getByText('Not fetched yet')).toBeInTheDocument();
    expect(within(ca).queryByRole('img')).toBeNull();
  });

  it('refreshUpdatesAsOf', async () => {
    await setup();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Updated automatically · as of 9:05 am')).toBeInTheDocument();
    expect(calls).toContainEqual({
      url: '/api/exchange-rates/refresh',
      method: 'POST',
      body: undefined,
    });
  });

  it('refreshFailureShowsMessage', async () => {
    server.refreshFails = true;
    await setup();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText("Couldn't refresh the rate — showing the last one")
    ).toBeInTheDocument();
  });

  it('enterKeyTogglesRow', async () => {
    await setup();
    rowOf('Canada').focus();
    await userEvent.keyboard('{Enter}');
    expect(rowOf('Canada')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(rowOf('Canada')).toHaveAttribute('aria-expanded', 'false');
  });

  it('positiveChangeIsGreen', async () => {
    server.yearAgoRate = 0.7;
    await setup();
    const change = within(rowOf('1 CAD')).getByText('+0.7%');
    expect(change.className).toContain('text-[var(--green)]');
  });

  it('noYearAgoRateShowsDash', async () => {
    server.yearAgoRate = null;
    await setup();
    expect(within(rowOf('1 CAD')).getByText('—')).toBeInTheDocument();
  });

  it('sparklineClickDoesNotToggleRow', async () => {
    await setup();
    await userEvent.click(within(rowOf('1 CAD')).getByRole('img', { name: 'Past year' }));
    expect(rowOf('1 CAD')).toHaveAttribute('aria-expanded', 'false');
  });

  it('priceIndexFailureShowsMessage', async () => {
    server.failing = ['/api/price-index'];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GeneralSettings onSaved={vi.fn()} />);
    expect(await screen.findByText("Couldn't load settings")).toBeInTheDocument();
    expect(screen.queryByText('Inflation')).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('settingsFailureAllowsNoSave', async () => {
    server.failing = ['/api/settings'];
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GeneralSettings onSaved={vi.fn()} />);
    expect(await screen.findByText("Couldn't load settings")).toBeInTheDocument();
    expect(screen.queryByLabelText('Base currency')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('showsNoRatesLine', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const data =
        u === '/api/exchange-rates'
          ? { rates: [] }
          : u === '/api/price-index'
            ? { selected: 'US', regions: [] }
            : { settings: { id: 's1', baseCurrency: 'USD', inflationRegion: 'US' } };
      return { ok: true, status: 200, json: async () => data } as Response;
    }) as unknown as typeof fetch;
    render(<GeneralSettings onSaved={vi.fn()} />);
    expect(await screen.findByText('No exchange rates yet')).toBeInTheDocument();
  });
});
