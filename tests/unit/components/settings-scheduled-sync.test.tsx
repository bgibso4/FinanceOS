import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  yearAgoRate: null,
  weekly: [],
  monthEnds: [],
};

function stub(status: object, rates: object[] = []) {
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const body =
      u === '/api/scheduled-sync/status'
        ? status
        : u === '/api/exchange-rates'
          ? { rates }
          : u === '/api/price-index'
            ? { selected: 'US', regions: [] }
            : u === '/api/settings'
              ? { settings: { id: 's1', baseCurrency: 'USD', inflationRegion: 'US' } }
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

describe('Settings → General', () => {
  beforeEach(() => {
    nav.tab = 'general';
  });

  // The tab's behaviour is covered in general-settings.test.tsx; this checks the page mounts it.
  it('rendersGeneralSettings', async () => {
    stub(RAN, [CAD_USD]);
    render(<SettingsPage />);
    expect(await screen.findByText('Updated automatically · as of 2:14 pm')).toBeInTheDocument();
    expect(screen.getByLabelText('Base currency')).toHaveValue('USD');
  });
});
