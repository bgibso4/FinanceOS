import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=accounts'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/institutions/ConnectedInstitutions', () => ({
  ConnectedInstitutions: () => null,
}));
vi.mock('@/components/sync-settings', () => ({ SyncSettings: () => null }));
vi.mock('@/components/rules/RulesTab', () => ({ RulesTab: () => null }));
vi.mock('@/components/plaid/PlaidAccountLinkSelector', () => ({
  PlaidAccountLinkSelector: () => null,
}));
vi.mock('@/components/plaid/PlaidReconnectButton', () => ({
  PlaidReconnectButton: () => null,
}));
vi.mock('@/components/teller/TellerAccountLinkSelector', () => ({
  TellerAccountLinkSelector: () => null,
}));
vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import SettingsPage from '@/app/(routes)/settings/page';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { BalanceSource } from '@/lib/investments/codes';

const ACCOUNTS = [
  {
    id: 'acc-checking',
    name: 'Test Checking',
    type: 'checking',
    institution: 'Test Bank',
    currency: 'USD',
    isActive: true,
    trackingMode: 'cash_flow',
    balanceSource: null,
  },
  {
    id: 'acc-valued',
    name: 'Test Valued',
    type: 'brokerage',
    institution: 'Test Bank',
    currency: 'USD',
    isActive: true,
    trackingMode: 'investment',
    balanceSource: BalanceSource.Valuation,
  },
  {
    id: 'acc-manual',
    name: 'Test Manual',
    type: 'retirement',
    institution: 'Test Bank',
    currency: 'USD',
    isActive: true,
    trackingMode: 'investment',
    balanceSource: BalanceSource.Manual,
  },
];

type Reply = { status?: number; body: unknown };
let patchReply: Reply;
let accounts: typeof ACCOUNTS;

const respond = (r: Reply) =>
  ({
    ok: (r.status ?? 200) < 400,
    status: r.status ?? 200,
    json: async () => r.body,
  }) as Response;

// dnd-kit constructs a ResizeObserver; the shared setup's mock is not constructible.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  global.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  patchReply = { body: {} };
  accounts = ACCOUNTS;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'PATCH' && u.startsWith('/api/accounts/')) return respond(patchReply);
    if (u === '/api/accounts') return respond({ body: { accounts } });
    if (/^\/api\/investments\/accounts\/[^/]+\/balances$/.test(u)) {
      return respond({ body: { balances: [], enterBefore: null, today: '2026-10-09' } });
    }
    if (/^\/api\/investments\/accounts\/[^/]+\/holdings$/.test(u)) {
      return respond({ body: { holdings: [], pricesAsOf: null } });
    }
    return respond({ body: {} });
  }) as unknown as typeof fetch;
});

const fetchCalls = () =>
  vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    key: `${init?.method ?? 'GET'} ${String(url)}`,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));
const fetchedUrls = () => fetchCalls().map((c) => c.key);

const cardButton = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const cardFor = (name: string) => cardButton(name).closest('[data-selected]');
const pageRoot = () =>
  screen.getByRole('heading', { level: 1, name: 'Settings' }).parentElement!.parentElement!;

async function openCard(name: string) {
  await screen.findByText(name);
  await userEvent.click(cardButton(name));
  return screen.getByRole('dialog', { name: `Manage ${name}` });
}

describe('Settings → Accounts drawer', () => {
  it('clicking a card opens the drawer on that account and highlights the card', async () => {
    render(<SettingsPage />);
    await userEvent.click(await screen.findByText('Test Checking'));
    expect(screen.getByRole('dialog', { name: 'Manage Test Checking' })).toBeInTheDocument();
    expect(cardFor('Test Checking')).toHaveAttribute('data-selected', 'true');
    expect(cardFor('Test Valued')).not.toHaveAttribute('data-selected', 'true');
    expect(cardButton('Test Checking')).toHaveAttribute('aria-pressed', 'true');
    expect(pageRoot()).toHaveClass(DRAWER_PUSH_CLASS);
  });

  it('opens a card from the keyboard', async () => {
    render(<SettingsPage />);
    await screen.findByText('Test Checking');
    cardButton('Test Checking').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Manage Test Checking' })).toBeInTheDocument();
  });

  it('clicking another card swaps the drawer and resets its sections', async () => {
    render(<SettingsPage />);
    const drawer = await openCard('Test Manual');
    await userEvent.click(
      await within(drawer).findByRole('button', { name: 'Paste several from a spreadsheet' })
    );
    expect(screen.getByLabelText('Paste past balances')).toBeInTheDocument();
    await userEvent.click(cardButton('Test Valued'));
    expect(screen.getByRole('dialog', { name: 'Manage Test Valued' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Paste past balances')).toBeNull();
    await waitFor(() =>
      expect(fetchedUrls()).toContain('GET /api/investments/accounts/acc-valued/balances')
    );
  });

  it('Esc closes the drawer and the page stops making room for it', async () => {
    render(<SettingsPage />);
    await openCard('Test Checking');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pageRoot()).not.toHaveClass(DRAWER_PUSH_CLASS);
    expect(cardButton('Test Checking')).toHaveFocus();
  });

  it('an investment account shows its source sections and no Reconcile', async () => {
    render(<SettingsPage />);
    const drawer = await openCard('Test Valued');
    expect(
      within(drawer).getByText('Investment: holdings and balance history')
    ).toBeInTheDocument();
    expect(within(drawer).getByRole('radio', { name: /Valued/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(await within(drawer).findByText('Holdings')).toBeInTheDocument();
    expect(await within(drawer).findByText('Balances you entered')).toBeInTheDocument();
    expect(within(drawer).queryByText('Reconcile Balance')).toBeNull();
    expect(within(drawer).getByText('Test Bank · Investment · Valued')).toBeInTheDocument();
  });

  it('an everyday account keeps Reconcile and the tracking select', async () => {
    render(<SettingsPage />);
    const drawer = await openCard('Test Checking');
    expect(within(drawer).getByText('Reconcile Balance')).toBeInTheDocument();
    expect(within(drawer).getByText('Bank Connection')).toBeInTheDocument();
    expect(within(drawer).getByDisplayValue('Cash Flow (budgeting)')).toBeInTheDocument();
    expect(within(drawer).queryByRole('radiogroup')).toBeNull();
    expect(within(drawer).queryByText('Balances you entered')).toBeNull();
  });

  it('Save changes sends the balance source and keeps the drawer open', async () => {
    render(<SettingsPage />);
    const drawer = await openCard('Test Valued');
    await userEvent.click(within(drawer).getByRole('radio', { name: /Manual/ }));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(fetchCalls().find((c) => c.key === 'PATCH /api/accounts/acc-valued')?.body).toEqual(
        expect.objectContaining({ balanceSource: BalanceSource.Manual })
      )
    );
    expect(screen.getByRole('dialog', { name: 'Manage Test Valued' })).toBeInTheDocument();
  });

  it('keeps the sections on the saved source until Save, then refetches them', async () => {
    render(<SettingsPage />);
    const drawer = await openCard('Test Valued');
    expect(await within(drawer).findByText('Holdings')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('radio', { name: /Manual/ }));
    expect(within(drawer).getByText('Holdings')).toBeInTheDocument();
    const balanceGets = () =>
      fetchedUrls().filter((u) => u === 'GET /api/investments/accounts/acc-valued/balances').length;
    await waitFor(() => expect(balanceGets()).toBe(1));

    accounts = ACCOUNTS.map((a) =>
      a.id === 'acc-valued' ? { ...a, balanceSource: BalanceSource.Manual } : a
    );
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(within(drawer).queryByText('Holdings')).toBeNull());
    expect(within(drawer).getByText('Test Bank · Investment · Manual')).toBeInTheDocument();
    await waitFor(() => expect(balanceGets()).toBe(2));
  });

  it('does not send a balance source for an everyday account', async () => {
    render(<SettingsPage />);
    const drawer = await openCard('Test Checking');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(fetchCalls().some((c) => c.key === 'PATCH /api/accounts/acc-checking')).toBe(true)
    );
    const patch = fetchCalls().find((c) => c.key === 'PATCH /api/accounts/acc-checking');
    expect(patch?.body).not.toHaveProperty('balanceSource');
  });

  it('shows a refused save under Save changes', async () => {
    patchReply = {
      status: 400,
      body: { error: 'Synced needs a connection to this account’s institution.' },
    };
    render(<SettingsPage />);
    const drawer = await openCard('Test Valued');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'Synced needs a connection to this account’s institution.'
    );
    expect(screen.getByRole('dialog', { name: 'Manage Test Valued' })).toBeInTheDocument();
  });
});
