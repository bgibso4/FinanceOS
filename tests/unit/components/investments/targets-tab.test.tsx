import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetsTab } from '@/components/investments/targets-tab';
import { Pricing } from '@/lib/investments/codes';
import type { TargetSettingsView } from '@/lib/investments/targets/settings';
import { finalTargets, targetTotals } from '@/lib/investments/targets/allocation';
import { triggerSync } from '@/lib/cloud-sync';
import { makeSecurityItem } from '../../../helpers/investment-overview';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

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
        heldIn: ['a-1'],
        valueBase: 1000,
        classId: null,
        regionId: null,
      },
    ],
    accounts: [
      {
        id: 'a-1',
        name: 'Brokerage',
        institution: 'Fidelity',
        balanceOnly: false,
        inTargets: true,
        valueBase: 1000,
      },
      {
        id: 'a-2',
        name: 'Old RRSP',
        institution: null,
        balanceOnly: true,
        inTargets: false,
        valueBase: 500,
      },
    ],
    ...over,
  };
}

let view: TargetSettingsView;
/** The reply to each PUT, by its body; the saved view by default. */
let putReply: (body: { section: string }) => { status: number; body: unknown };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(triggerSync).mockClear();
  view = makeView();
  putReply = () => ({ status: 200, body: view });
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    const reply = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (key === 'GET /api/investments/targets') return reply(200, view);
    if (key === 'PUT /api/investments/targets') {
      const { status, body } = putReply(JSON.parse(String(init?.body)));
      return reply(status, body);
    }
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
const saveButton = () => screen.queryByRole('button', { name: 'Save changes' });
const setPct = async (
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string
) => {
  await user.clear(field);
  await user.type(field, text);
};

describe('TargetsTab', () => {
  it('shows the summary and the four cards, with no save bar until something changes', async () => {
    render(<TargetsTab />);
    await ready();
    for (const title of [
      'Your targets',
      'Asset classes',
      'Stocks by region',
      'Accounts',
      'Funds',
    ]) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(saveButton()).toBeNull();
    expect(card('Accounts').getByText('Balance only, no funds to count')).toBeTruthy();
    expect(card('Accounts').getByText('Fidelity')).toBeTruthy();
    expect(card('Accounts').getByText('1 of 2 counted')).toBeTruthy();
    expect(card('Your targets').getByText('$1,000 in 1 counted account')).toBeTruthy();
  });

  it('tilt previews the targets live, in the card and the summary', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    expect(card('Stocks by region').queryByText('48.6%')).toBeNull();
    const calls = vi.mocked(global.fetch).mock.calls.length;
    await setPct(user, card('Stocks by region').getByLabelText('Tilt for US'), '20');
    expect(card('Stocks by region').getByText('48.6%')).toBeTruthy();
    expect(card('Your targets').getByText('48.6%')).toBeTruthy();
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(calls);
  });

  it('saves every changed section with one button, in order', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    await user.click(card('Accounts').getByRole('checkbox', { name: /Old RRSP/ }));
    await user.selectOptions(card('Funds').getByLabelText('Target for AAA'), 'Crypto');
    await setPct(user, card('Asset classes').getByLabelText('Target for Crypto'), '10%');
    expect(puts()).toHaveLength(0);
    expect(screen.getByText('Unsaved changes: Asset classes, Funds, Accounts')).toBeTruthy();

    view = makeView({
      classes: classes.map((c) => (c.id === 'c-crypto' ? { ...c, pct: 10 } : c)),
      funds: makeView().funds.map((f) => ({ ...f, classId: 'c-crypto' })),
      accounts: makeView().accounts.map((a) => ({ ...a, inTargets: true })),
    });
    await user.click(saveButton()!);
    await waitFor(() => expect(saveButton()).toBeNull());
    expect(puts().map((p) => p.section)).toEqual(['classes', 'funds', 'accounts']);
    expect(puts()[0].items.find((i: { id: string }) => i.id === 'c-crypto').pct).toBe(10);
    expect(puts()[1].items).toEqual([
      { securityId: 'sec-aaa', classId: 'c-crypto', regionId: null },
    ]);
    expect(puts()[2].items).toEqual([
      { accountId: 'a-1', inTargets: true },
      { accountId: 'a-2', inTargets: true },
    ]);
    expect(triggerSync).toHaveBeenCalledTimes(1);
    expect(
      (card('Asset classes').getByLabelText('Target for Crypto') as HTMLInputElement).value
    ).toBe('10');
  });

  it('discards every change', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    await setPct(user, card('Asset classes').getByLabelText('Target for Crypto'), '10');
    await user.click(card('Accounts').getByRole('checkbox', { name: /Brokerage/ }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(saveButton()).toBeNull();
    expect(
      (card('Asset classes').getByLabelText('Target for Crypto') as HTMLInputElement).value
    ).toBe('5');
    expect(
      (card('Accounts').getByRole('checkbox', { name: /Brokerage/ }) as HTMLInputElement).checked
    ).toBe(true);
    expect(puts()).toHaveLength(0);
  });

  it('stops at the section that fails, names it, and keeps the rest unsaved', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    await setPct(user, card('Asset classes').getByLabelText('Target for Crypto'), '10');
    await user.click(card('Accounts').getByRole('checkbox', { name: /Old RRSP/ }));
    putReply = () => ({ status: 400, body: { error: 'Keep at least one class' } });
    await user.click(saveButton()!);
    expect(await screen.findByText('Asset classes: Keep at least one class')).toBeTruthy();
    expect(puts().map((p) => p.section)).toEqual(['classes']);
    expect(triggerSync).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes: Asset classes, Accounts')).toBeTruthy();

    putReply = () => ({ status: 200, body: view });
    await user.click(saveButton()!);
    await waitFor(() => expect(triggerSync).toHaveBeenCalledTimes(1));
    expect(puts().map((p) => p.section)).toEqual(['classes', 'classes', 'accounts']);
  });

  it('funds list the live targets', async () => {
    render(<TargetsTab />);
    await ready();
    const select = card('Funds').getByLabelText('Target for AAA') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      'Not counted',
      'Stocks · US',
      'Stocks · Developed ex-US',
      'Stocks · Emerging',
      'Fixed income',
      'Crypto',
    ]);
    expect(card('Funds').getByText('0 of 1 assigned')).toBeTruthy();
    expect(card('Funds').getByText('Brokerage')).toBeTruthy();
  });

  it('tags a fund whose accounts are all left out', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    expect(card('Funds').queryByText('account left out')).toBeNull();
    await user.click(card('Accounts').getByRole('checkbox', { name: /Brokerage/ }));
    expect(card('Funds').getByText('account left out')).toBeTruthy();
  });

  it('tells accounts that share a name apart by institution', async () => {
    const base = makeView();
    view = makeView({
      accounts: [
        { ...base.accounts[0], name: 'Roth IRA' },
        { ...base.accounts[1], name: 'Roth IRA', institution: 'Schwab' },
      ],
      funds: [{ ...base.funds[0], heldIn: ['a-1', 'a-2'] }],
    });
    render(<TargetsTab />);
    await ready();
    expect(card('Funds').getByText('Roth IRA (Fidelity), Roth IRA (Schwab)')).toBeTruthy();
  });

  it('scaling notes', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    expect(card('Stocks by region').getByText('Countries 99.34% · scaled to 100%')).toBeTruthy();
    expect(card('Asset classes').getByText('Total 100%')).toBeTruthy();
    await setPct(user, card('Asset classes').getByLabelText('Target for Crypto'), '0');
    expect(card('Asset classes').getByText('Total 95.00% · scaled to 100%')).toBeTruthy();
    // 80 of 95, split 56.27% to the US
    expect(card('Your targets').getByText('47.4%')).toBeTruthy();
    expect(saveButton()).toBeTruthy();
  });

  it('offers only market-priced securities to buy with', async () => {
    render(<TargetsTab />);
    await ready();
    const select = card('Asset classes').getByLabelText('Buy with for Fixed income');
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['None', 'AAA']);
    expect(card('Stocks by region').getByLabelText('Buy with for US')).toBeTruthy();
  });

  it('parses +20 and ignores unparsable input', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const tilt = card('Stocks by region').getByLabelText('Tilt for US');
    await setPct(user, tilt, '+20');
    expect(card('Stocks by region').getByText('48.6%')).toBeTruthy();
    await user.type(tilt, 'abc');
    expect(card('Stocks by region').getByText('48.6%')).toBeTruthy();
  });

  it('sends a half-assigned fund as Not counted so it cannot block the save', async () => {
    view = makeView({
      funds: [
        ...makeView().funds,
        {
          securityId: 'sec-half',
          label: 'HALF',
          name: 'Half fund',
          heldIn: ['a-1'],
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
    expect(saveButton()).toBeNull();
    await user.selectOptions(card('Funds').getByLabelText('Target for AAA'), 'Crypto');
    await user.click(saveButton()!);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].items).toEqual([
      { securityId: 'sec-aaa', classId: 'c-crypto', regionId: null },
      { securityId: 'sec-half', classId: null, regionId: null },
    ]);
  });

  it('edits countries inside their region, and only an empty region can be removed', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const regionsCard = card('Stocks by region');
    expect(regionsCard.queryByLabelText('Weight for USA')).toBeNull();
    expect(regionsCard.queryByRole('button', { name: 'Remove US' })).toBeNull();
    await user.click(regionsCard.getByRole('button', { name: 'Countries in US' }));
    await setPct(user, regionsCard.getByLabelText('Weight for USA'), '60');
    expect(screen.getByText('Unsaved changes: Countries')).toBeTruthy();
    await user.click(regionsCard.getByRole('button', { name: 'Remove USA' }));
    await user.click(regionsCard.getByRole('button', { name: 'Remove US' }));
    expect(regionsCard.queryByLabelText('Tilt for US')).toBeNull();
    await user.click(saveButton()!);
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts().map((p) => p.section)).toEqual(['regions', 'countries']);
    expect(puts()[0].items.map((i: { id: string }) => i.id)).toEqual(['r-dev', 'r-em']);
    expect(puts()[1].items.map((i: { id: string }) => i.id)).toEqual(['n-dev', 'n-em']);
  });

  it('saves a country under a region added in the same save', async () => {
    render(<TargetsTab />);
    await ready();
    const user = userEvent.setup();
    const regionsCard = card('Stocks by region');
    await user.click(regionsCard.getByRole('button', { name: '+ Add region' }));
    await user.click(regionsCard.getByRole('button', { name: 'Countries in New region' }));
    await user.click(regionsCard.getByRole('button', { name: '+ Add country' }));
    const added = { id: 'r-new', name: 'New region', tiltPct: 0, buySecurityId: null };
    putReply = (body) =>
      body.section === 'regions'
        ? { status: 200, body: makeView({ regions: [...regions, added] }) }
        : { status: 400, body: { error: 'Unknown region' } };
    await user.click(saveButton()!);
    expect(await screen.findByText('Countries: Unknown region')).toBeTruthy();
    expect(puts()[1].items.at(-1)).toEqual({
      name: 'New country',
      weightPct: 0,
      regionId: 'r-new',
    });
    // The unsaved country still sits under the region, now by its saved id.
    expect(regionsCard.getByLabelText('Weight for New country')).toBeTruthy();
    await user.click(saveButton()!);
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()[2].section).toBe('countries');
    expect(puts()[2].items.at(-1).regionId).toBe('r-new');
  });

  it('shows amounts in the base currency', async () => {
    view = makeView({ baseCurrency: 'CAD' });
    render(<TargetsTab />);
    await ready();
    expect(card('Funds').getByText('CA$1,000')).toBeTruthy();
  });

  it('collapses a card to its header, keeps its edits, and remembers the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TargetsTab />);
    await ready();
    expect(screen.queryByRole('button', { name: 'Your targets' })).toBeNull();
    await user.click(card('Accounts').getByRole('checkbox', { name: /Old RRSP/ }));
    const header = card('Accounts').getByRole('button', { name: 'Accounts' });
    expect(header.getAttribute('aria-expanded')).toBe('true');

    await user.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(card('Accounts').queryByRole('checkbox')).toBeNull();
    expect(card('Accounts').getByText('1 of 2 counted')).toBeTruthy();
    expect(saveButton()).toBeTruthy();
    expect(card('Funds').getByLabelText('Target for AAA')).toBeTruthy();

    unmount();
    render(<TargetsTab />);
    await ready();
    expect(card('Accounts').queryByRole('checkbox')).toBeNull();
    await user.click(card('Accounts').getByRole('button', { name: 'Accounts' }));
    expect(card('Accounts').getAllByRole('checkbox')).toHaveLength(2);
  });
});
