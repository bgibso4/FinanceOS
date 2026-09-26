import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstitutionCard } from '@/components/institutions/InstitutionCard';
import type { InstitutionView } from '@/components/institutions/types';

// The Add accounts button renders unconditionally (regardless of `view.status`), so
// TellerReconnectButton and PlaidReconnectButton always mount here even though
// `status: 'connected'` keeps the separately-gated Reconnect button off. Teller's
// widget needs `window.TellerConnect` stubbed below so its script-loading effect
// resolves instead of hanging; Plaid's `usePlaidLink` tolerates a null token fine
// without any stub.
function buildView(overrides: Partial<InstitutionView> = {}): InstitutionView {
  return {
    key: 'teller-enr_1',
    provider: 'teller',
    id: 'db_1',
    updateTargetId: 'update_1',
    institutionId: 'chase',
    institutionName: 'Chase',
    status: 'connected',
    linked: [
      {
        connectionId: 'conn_1',
        externalId: 'acc_linked',
        bankAccountName: 'Chase Checking',
        linkedAccountName: 'Everyday Checking',
        status: 'connected',
      },
    ],
    discovered: [
      {
        externalId: 'acc_new_1',
        name: 'Amazon Prime Card',
        type: 'credit',
        subtype: 'credit_card',
        lastFour: '4242',
      },
      {
        externalId: 'acc_new_2',
        name: 'Chase Savings',
        type: 'depository',
        subtype: 'savings',
        lastFour: '9911',
      },
    ],
    hidden: [
      {
        externalId: 'acc_hidden',
        name: 'Old Business Card',
        type: 'credit',
        subtype: 'credit_card',
        lastFour: '1000',
      },
    ],
    totalAccountCount: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Stub the Teller Connect script's global so TellerReconnectButton's loadScript()
  // resolves immediately instead of waiting on a real (jsdom-inert) <script> tag.
  window.TellerConnect = {
    setup: () => ({ open: vi.fn() }),
  } as unknown as Window['TellerConnect'];
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/api/ignored-accounts')) {
      return {
        json: async () => ({
          ignored: [
            {
              id: 'ignore_1',
              provider: 'teller',
              institutionId: 'chase',
              externalAccountId: 'acc_hidden',
              lastFour: '1000',
              name: 'Old Business Card',
            },
          ],
        }),
      } as Response;
    }
    if (String(url).includes('/api/teller/config')) {
      return {
        json: async () => ({ applicationId: 'app_test', environment: 'sandbox' }),
      } as Response;
    }
    return { json: async () => ({ success: true }) } as Response;
  }) as unknown as typeof fetch;
});

const noop = () => {};

describe('InstitutionCard', () => {
  it('renders linked and discovered accounts together, with the badge and Hidden section (teller)', async () => {
    const view = buildView();

    render(
      <InstitutionCard
        isExpanded
        disconnecting={false}
        view={view}
        onDisconnect={noop}
        onRefresh={noop}
        onToggle={noop}
      />
    );

    // The regression this test guards: a non-empty `discovered` list must not suppress
    // the linked accounts. Both must be visible at once. The linked account's name is
    // rendered as "Linked to: Everyday Checking" (two text nodes in one <p>), so match
    // on a substring rather than the exact element text.
    expect(screen.getByText(/Everyday Checking/)).toBeInTheDocument(); // linked
    expect(screen.getByText('Amazon Prime Card')).toBeInTheDocument(); // discovered

    // Header badge reads the discovered count, plural for 2.
    expect(screen.getByText('2 new accounts')).toBeInTheDocument();

    // Hidden section shows its count, and — once expanded — its entries.
    const hiddenToggle = screen.getByRole('button', { name: /Hidden \(1\)/ });
    expect(hiddenToggle).toBeInTheDocument();
    expect(screen.queryByText('Old Business Card')).not.toBeInTheDocument();

    await userEvent.click(hiddenToggle);

    await waitFor(() => expect(screen.getByText('Old Business Card')).toBeInTheDocument());
    expect(
      vi.mocked(global.fetch).mock.calls.some(([url]) => String(url) === '/api/ignored-accounts')
    ).toBe(true);
  });

  it('renders linked and discovered accounts together, with the badge and Hidden section (plaid)', async () => {
    const view = buildView({
      key: 'plaid-enr_1',
      provider: 'plaid',
      discovered: [
        {
          externalId: 'acc_new_1',
          name: 'Amazon Prime Card',
          type: 'credit',
          subtype: 'credit_card',
          lastFour: '4242',
        },
      ],
    });

    render(
      <InstitutionCard
        isExpanded
        disconnecting={false}
        view={view}
        onDisconnect={noop}
        onRefresh={noop}
        onToggle={noop}
      />
    );

    expect(screen.getByText(/Everyday Checking/)).toBeInTheDocument(); // linked
    expect(screen.getByText('Amazon Prime Card')).toBeInTheDocument(); // discovered

    // Singular for 1 discovered account.
    expect(screen.getByText('1 new account')).toBeInTheDocument();

    const hiddenToggle = screen.getByRole('button', { name: /Hidden \(1\)/ });
    await userEvent.click(hiddenToggle);

    await waitFor(() => expect(screen.getByText('Old Business Card')).toBeInTheDocument());
    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });

  it('renders the Add accounts button for a healthy institution, where previously no provider button appeared', async () => {
    const view = buildView(); // status: 'connected'

    render(
      <InstitutionCard
        isExpanded
        disconnecting={false}
        view={view}
        onDisconnect={noop}
        onRefresh={noop}
        onToggle={noop}
      />
    );

    // Before this task, a healthy (`connected`) institution rendered no Teller/Plaid
    // button at all — Reconnect was gated on broken statuses and there was no other
    // provider entry point. Add accounts is unconditional, so it must show up here.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add accounts' })).toBeInTheDocument()
    );
    // Reconnect stays gated on broken statuses, so it must not also render.
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
  });
});
