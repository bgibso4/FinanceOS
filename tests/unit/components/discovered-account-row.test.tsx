import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveredAccountRow } from '@/components/institutions/DiscoveredAccountRow';

const account = {
  externalId: 'acc_new',
  name: 'Amazon Prime Card',
  type: 'credit',
  subtype: 'credit_card',
  lastFour: '4242',
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(
    async () => ({ json: async () => ({ success: true }) }) as Response
  ) as unknown as typeof fetch;
});

describe('DiscoveredAccountRow', () => {
  it('shows the account name and last four', () => {
    render(
      <DiscoveredAccountRow
        account={account}
        institutionId="chase"
        provider="teller"
        onAdopt={vi.fn()}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('Amazon Prime Card')).toBeInTheDocument();
    expect(screen.getByText(/4242/)).toBeInTheDocument();
  });

  it('calls onAdopt with the account when Add is clicked', async () => {
    const onAdopt = vi.fn();
    render(
      <DiscoveredAccountRow
        account={account}
        institutionId="chase"
        provider="teller"
        onAdopt={onAdopt}
        onChanged={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdopt).toHaveBeenCalledWith(account);
  });

  it('posts an ignore record and refreshes when Ignore is clicked', async () => {
    const onChanged = vi.fn();
    render(
      <DiscoveredAccountRow
        account={account}
        institutionId="chase"
        provider="teller"
        onAdopt={vi.fn()}
        onChanged={onChanged}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ignore' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe('/api/ignored-accounts');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      provider: 'teller',
      institutionId: 'chase',
      externalAccountId: 'acc_new',
      lastFour: '4242',
    });
  });
});
