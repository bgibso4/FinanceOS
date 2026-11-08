import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NetWorthSnapshots } from '@/components/reports/NetWorthSnapshots';

const snapshot = {
  id: 's1',
  date: '2025-09-15T00:00:00.000Z',
  netWorth: 1000,
  totalAssets: 1000,
  totalLiabilities: 0,
  accountBalances: {},
  period: null,
  notes: null,
  isAutomatic: false,
  createdAt: '2025-09-15T00:00:00.000Z',
};

function stub(months: { month: string; value: number }[]) {
  global.fetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/price-index')
        ? {
            selected: 'US',
            regions: [
              { region: 'US', name: 'US', attribution: '', fetchedAt: null, months },
              { region: 'CA', name: 'Canada', attribution: '', fetchedAt: null, months: [] },
            ],
          }
        : { snapshots: [snapshot] },
  })) as unknown as typeof fetch;
}

describe('NetWorthSnapshots inflation view', () => {
  it('showsReferenceMonth', async () => {
    stub([
      { month: '2025-09', value: 324.8 },
      { month: '2026-09', value: 336.94 },
    ]);
    render(<NetWorthSnapshots />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inflation-Adjusted' }));
    expect(await screen.findByText('(in September 2026 prices)')).toBeInTheDocument();
  });

  it('hidesToggleWithoutIndex', async () => {
    stub([]);
    render(<NetWorthSnapshots />);
    await screen.findByText('Current Net Worth');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/price-index'));
    expect(screen.queryByRole('button', { name: 'Inflation-Adjusted' })).not.toBeInTheDocument();
  });
});
