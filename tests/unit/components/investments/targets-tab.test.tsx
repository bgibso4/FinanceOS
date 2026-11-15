import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetsTab } from '@/components/investments/targets-tab';
import { Pricing } from '@/lib/investments/codes';
import type { TargetSettingsView } from '@/lib/investments/targets/settings';
import { finalTargets, targetTotals } from '@/lib/investments/targets/allocation';
import { makeSecurityItem } from '../../../helpers/investment-overview';

const classes = [
  { id: 'c-stocks', name: 'Stocks', pct: 80, splitByRegion: true, buySecurityId: null },
  { id: 'c-fixed', name: 'Fixed income', pct: 15, splitByRegion: false, buySecurityId: null },
  { id: 'c-crypto', name: 'Crypto', pct: 5, splitByRegion: false, buySecurityId: null },
];
const regions = [
  { id: 'r-us', name: 'US', tiltPct: 0, buySecurityId: null },
  { id: 'r-dev', name: 'Developed ex-US', tiltPct: 0, buySecurityId: null },
  { id: 'r-em', name: 'Emerging', tiltPct: 0, buySecurityId: null },
];
const countries = [
  { id: 'n-usa', name: 'USA', weightPct: 55.9, regionId: 'r-us' },
  { id: 'n-dev', name: 'Developed', weightPct: 28.02, regionId: 'r-dev' },
  { id: 'n-em', name: 'Emerging markets', weightPct: 15.42, regionId: 'r-em' },
];

function makeView(over: Partial<TargetSettingsView> = {}): TargetSettingsView {
  const setup = { classes, regions, countries };
  return {
    baseCurrency: 'USD',
    ...setup,
    final: finalTargets(setup),
    totals: targetTotals(setup),
    funds: [
      {
        securityId: 'sec-aaa',
        label: 'AAA',
        name: 'Triple A Fund',
        heldIn: ['Brokerage'],
        valueBase: 1000,
        classId: null,
        regionId: null,
      },
    ],
    accounts: [
      { id: 'a-1', name: 'Brokerage', typedBalance: false, inTargets: true, valueBase: 1000 },
      { id: 'a-2', name: 'Old RRSP', typedBalance: true, inTargets: false, valueBase: 500 },
    ],
    ...over,
  };
}

let view: TargetSettingsView;
let putResponse: { status: number; body: unknown };

beforeEach(() => {
  view = makeView();
  putResponse = { status: 200, body: null };
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    const reply = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (key === 'GET /api/investments/targets') return reply(200, view);
    if (key === 'PUT /api/investments/targets') return reply(putResponse.status, putResponse.body);
    if (key === 'GET /api/investments/securities') {
      return reply(200, {
        symbolHint: '',
        securities: [
          makeSecurityItem({ id: 'sec-aaa', label: 'AAA', pricing: Pricing.Market }),
          makeSecurityItem({ id: 'sec-old', label: 'OLDF', pricing: Pricing.None }),
        ],
      });
    }
    return reply(404, { error: 'Not mocked' });
  }) as unknown as typeof fetch;
});

const puts = () =>
  vi
    .mocked(global.fetch)
    .mock.calls.filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)));
const card = (name: string) => within(screen.getByRole('region', { name }));
const ready = () => screen.findByRole('region', { name: 'Asset classes' });

describe('TargetsTab', () => {
  it('shows the five cards', async () => {
    render(<TargetsTab />);
    await ready();
    for (const title of ['Asset classes', 'Stocks by region', 'Countries', 'Funds', 'Accounts']) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }
    expect(screen.getByText(/typed-in balance, left out even when ticked/)).toBeTruthy();
  });

  it('tilt previews the targets live', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    expect(card('Stocks by region').queryByText('60.7%')).toBeNull();
    const calls = vi.mocked(global.fetch).mock.calls.length;
    const tilt = card('Stocks by region').getByLabelText('Tilt for US');
    await user.clear(tilt);
    await user.type(tilt, '20');
    expect(card('Stocks by region').getByText('60.7%')).toBeTruthy();
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(calls);
  });

  it('saves one card', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const save = card('Asset classes').getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const crypto = card('Asset classes').getByLabelText('Target for Crypto');
    await user.clear(crypto);
    await user.type(crypto, '10%');
    expect((save as HTMLButtonElement).disabled).toBe(false);
    view = makeView({ classes: classes.map((c) => (c.id === 'c-crypto' ? { ...c, pct: 10 } : c)) });
    putResponse = { status: 200, body: view };
    await user.click(save);
    await waitFor(() => expect(puts()).toHaveLength(1));
    const body = puts()[0];
    expect(body.section).toBe('classes');
    expect(body.items.find((i: { id: string }) => i.id === 'c-crypto').pct).toBe(10);
    await waitFor(() =>
      expect(
        (card('Asset classes').getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
    expect(
      (card('Asset classes').getByLabelText('Target for Crypto') as HTMLInputElement).value
    ).toBe('10');
  });

  it('shows a save error', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const crypto = card('Asset classes').getByLabelText('Target for Crypto');
    await user.clear(crypto);
    await user.type(crypto, '10');
    putResponse = { status: 400, body: { error: 'Keep at least one class' } };
    await user.click(card('Asset classes').getByRole('button', { name: 'Save' }));
    expect(await card('Asset classes').findByText('Keep at least one class')).toBeTruthy();
  });

  it('funds pick a target', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const select = card('Funds').getByLabelText('Target for AAA') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      'Not counted',
      'Stocks · US',
      'Stocks · Developed ex-US',
      'Stocks · Emerging',
      'Fixed income',
      'Crypto',
    ]);
    putResponse = { status: 200, body: view };
    await user.selectOptions(select, 'Stocks · US');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({
      section: 'funds',
      items: [{ securityId: 'sec-aaa', classId: 'c-stocks', regionId: 'r-us' }],
    });
  });

  it('scaling note', async () => {
    render(<TargetsTab />);
    await ready();
    expect(card('Countries').getByText('Total 99.34% · scaled to 100%')).toBeTruthy();
    expect(card('Asset classes').getByText('Total 100%')).toBeTruthy();
  });

  it('offers only market-priced securities to buy with', async () => {
    render(<TargetsTab />);
    await ready();
    const select = card('Asset classes').getByLabelText('Buy with for Fixed income');
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['None', 'AAA']);
    expect(card('Stocks by region').getByLabelText('Buy with for US')).toBeTruthy();
  });

  it('keeps another card’s unsaved draft when a different card saves', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const crypto = card('Asset classes').getByLabelText('Target for Crypto');
    await user.clear(crypto);
    await user.type(crypto, '9');
    putResponse = { status: 200, body: view };
    await user.click(card('Accounts').getAllByRole('checkbox')[0]);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(
      (card('Asset classes').getByLabelText('Target for Crypto') as HTMLInputElement).value
    ).toBe('9');
    expect(
      (card('Asset classes').getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('parses +20 and ignores unparsable input', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const tilt = card('Stocks by region').getByLabelText('Tilt for US');
    await user.clear(tilt);
    await user.type(tilt, '+20');
    expect(card('Stocks by region').getByText('60.7%')).toBeTruthy();
    await user.type(tilt, 'abc');
    expect(card('Stocks by region').getByText('60.7%')).toBeTruthy();
  });

  it('shows an error from the Funds and Accounts saves', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    putResponse = { status: 400, body: { error: 'Unknown security' } };
    await user.selectOptions(card('Funds').getByLabelText('Target for AAA'), 'Crypto');
    expect(await card('Funds').findByText('Unknown security')).toBeTruthy();
    putResponse = { status: 400, body: { error: 'Unknown account' } };
    await user.click(card('Accounts').getAllByRole('checkbox')[0]);
    expect(await card('Accounts').findByText('Unknown account')).toBeTruthy();
  });

  it('sends a half-assigned fund as Not counted so it cannot block the save', async () => {
    view = makeView({
      funds: [
        ...makeView().funds,
        {
          securityId: 'sec-half',
          label: 'HALF',
          name: 'Half fund',
          heldIn: ['Brokerage'],
          valueBase: 10,
          classId: 'c-stocks',
          regionId: 'gone',
        },
      ],
    });
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    expect((card('Funds').getByLabelText('Target for HALF') as HTMLSelectElement).value).toBe('');
    putResponse = { status: 200, body: view };
    await user.selectOptions(card('Funds').getByLabelText('Target for AAA'), 'Crypto');
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].items).toEqual([
      { securityId: 'sec-aaa', classId: 'c-crypto', regionId: null },
      { securityId: 'sec-half', classId: null, regionId: null },
    ]);
  });

  it('will not remove a region that countries still use', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const remove = card('Stocks by region').getByRole('button', { name: 'Remove US' });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(remove.getAttribute('title')).toBe('Move its countries to another region first');
    await user.selectOptions(card('Countries').getByLabelText('Region for USA'), 'Emerging');
    expect((remove as HTMLButtonElement).disabled).toBe(true); // saved countries still use it
    view = makeView({
      countries: countries.map((c) => (c.id === 'n-usa' ? { ...c, regionId: 'r-em' } : c)),
    });
    putResponse = { status: 200, body: view };
    await user.click(card('Countries').getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        (card('Stocks by region').getByRole('button', { name: 'Remove US' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
  });

  it('shows amounts in the base currency', async () => {
    view = makeView({ baseCurrency: 'CAD' });
    render(<TargetsTab />);
    await ready();
    expect(card('Funds').getByText('CA$1,000')).toBeTruthy();
  });
});
