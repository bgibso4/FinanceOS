import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openMock = vi.fn();
let capturedSetup: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  capturedSetup = {};
  window.TellerConnect = {
    setup: (options: Record<string, unknown>) => {
      capturedSetup = options;
      return { open: openMock };
    },
  } as unknown as Window['TellerConnect'];

  global.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/api/teller/config')) {
      return {
        json: async () => ({ applicationId: 'app_test', environment: 'sandbox' }),
      } as Response;
    }
    return {
      json: async () => ({
        success: true,
        reconnected: 4,
        discovered: [{ externalId: 'acc_new', name: 'Amazon Card', lastFour: '4242' }],
        unmatched: [],
      }),
    } as Response;
  }) as unknown as typeof fetch;
});

import { TellerReconnectButton } from '@/components/teller/TellerReconnectButton';

describe('TellerReconnectButton', () => {
  it('renders Reconnect in the default mode', async () => {
    render(
      <TellerReconnectButton enrollmentId="enr_1" institutionName="Chase" onSuccess={vi.fn()} />
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    expect(screen.getByRole('button')).toHaveTextContent('Reconnect');
  });

  it('renders Add accounts in add-accounts mode', async () => {
    render(
      <TellerReconnectButton
        enrollmentId="enr_1"
        institutionName="Chase"
        mode="add-accounts"
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    expect(screen.getByRole('button')).toHaveTextContent('Add accounts');
  });

  it('posts to the update route and reports the result', async () => {
    const onResult = vi.fn();
    const onSuccess = vi.fn();

    render(
      <TellerReconnectButton
        enrollmentId="enr_1"
        institutionName="Chase"
        mode="add-accounts"
        onResult={onResult}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    await userEvent.click(screen.getByRole('button'));
    expect(openMock).toHaveBeenCalled();

    // Drive Teller's callback the way the real widget would.
    const onTellerSuccess = capturedSetup.onSuccess as (payload: unknown) => Promise<void>;
    await onTellerSuccess({
      accessToken: 'fresh',
      enrollment: { id: 'enr_new', institution: { id: 'chase', name: 'Chase' } },
    });

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(
      vi
        .mocked(global.fetch)
        .mock.calls.some(([url]) => String(url).includes('/api/teller/enrollment/update'))
    ).toBe(true);
    expect(onResult.mock.calls[0][0].discovered).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalled();
  });
});
