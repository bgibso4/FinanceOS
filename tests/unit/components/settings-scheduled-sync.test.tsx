import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ tab: 'accounts' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(`tab=${nav.tab}`),
}));

import SettingsPage from '@/app/(routes)/settings/page';

// Local times, so the expected text does not depend on the machine's zone.
const at = (h: number, m: number) => new Date(2026, 10, 8, h, m).toISOString();

const OFF = {
  enabled: false,
  lastFinishedAt: null,
  nextAround: null,
  failedSteps: [],
  needsAttention: false,
};
const RAN = {
  enabled: true,
  lastFinishedAt: at(14, 14),
  nextAround: at(18, 15),
  failedSteps: [],
  needsAttention: false,
};
const CAD_USD = {
  fromCurrency: 'CAD',
  toCurrency: 'USD',
  rate: 0.73,
  date: '2026-11-08T00:00:00.000Z',
  updatedAt: at(14, 14),
};

let calls: { url: string; method: string }[];

function stub(status: object, rates: object[] = []) {
  calls = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET' });
    const body =
      u === '/api/scheduled-sync/status'
        ? status
        : u === '/api/exchange-rates'
          ? { rates }
          : u === '/api/exchange-rates/refresh'
            ? { pairs: 1, days: 1, failed: [] }
            : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  nav.tab = 'accounts';
});

describe('Settings → automatic sync status', () => {
  it('showsLastRunAndNext', async () => {
    stub(RAN);
    render(<SettingsPage />);
    expect(
      await screen.findByText('Synced automatically · last run 2:14 pm · next around 6:15 pm')
    ).toBeInTheDocument();
  });

  it('showsNotRunYet', async () => {
    stub({ ...OFF, enabled: true });
    render(<SettingsPage />);
    expect(await screen.findByText("Automatic sync hasn't run yet")).toBeInTheDocument();
  });

  it('showsOff', async () => {
    stub(OFF);
    render(<SettingsPage />);
    expect(await screen.findByText('Automatic sync is off')).toBeInTheDocument();
  });

  it('namesFailedStep', async () => {
    stub({ ...RAN, failedSteps: ['prices'], needsAttention: true });
    render(<SettingsPage />);
    expect(await screen.findByText(/couldn't update prices/)).toBeInTheDocument();
  });

  it('namesFailedInflationStep', async () => {
    stub({ ...RAN, failedSteps: ['inflation'], needsAttention: true });
    render(<SettingsPage />);
    expect(await screen.findByText(/couldn't update inflation/)).toBeInTheDocument();
  });
});

describe('Settings → daily exchange rate', () => {
  beforeEach(() => {
    nav.tab = 'general';
  });

  it('rateIsReadOnlyWithRefresh', async () => {
    stub(RAN, [CAD_USD]);
    render(<SettingsPage />);
    expect(
      await screen.findByText(/1 CAD = 0\.7300 USD today · updated automatically · as of /)
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('0.7200')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete this exchange rate')).not.toBeInTheDocument();

    const before = calls.filter((c) => c.url === '/api/exchange-rates').length;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: '/api/exchange-rates/refresh', method: 'POST' })
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/exchange-rates').length).toBeGreaterThan(before)
    );
  });

  it('showsAMessageWhenRefreshFails', async () => {
    stub(RAN, [CAD_USD]);
    const ok = global.fetch;
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      String(url) === '/api/exchange-rates/refresh'
        ? ({ ok: false, status: 500, json: async () => ({}) } as Response)
        : ok(url, init)
    ) as unknown as typeof fetch;
    render(<SettingsPage />);
    await screen.findByText(/1 CAD = 0\.7300 USD/);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText("Couldn't refresh the rate — showing the last one")
    ).toBeInTheDocument();
  });
});
