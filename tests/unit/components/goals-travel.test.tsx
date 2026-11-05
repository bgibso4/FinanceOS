import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

import GoalsPage from '@/app/(routes)/goals/page';

const goal = (over: Record<string, unknown>) => ({
  id: 'g',
  name: 'Test Goal',
  type: 'spending',
  targetAmount: 1000,
  trackingMethod: 'category',
  categoryId: null,
  tagId: null,
  accountId: null,
  startDate: null,
  endDate: null,
  status: 'active',
  currentAmount: 100,
  percentage: 10,
  remaining: 900,
  paceStatus: null,
  ...over,
});

const goals = [
  goal({
    id: 'g1',
    name: 'Test Travel 2026',
    trackingMethod: 'travel',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  }),
  goal({ id: 'g2', name: 'Test Food', category: { id: 'c', name: 'Food', parentId: null } }),
];

describe('Goals travel hand-off', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        json: async () =>
          url.startsWith('/api/goals')
            ? { goals }
            : url.includes('categories')
              ? { categories: [] }
              : url.includes('tags')
                ? { tags: [] }
                : { accounts: [] },
      }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('travelGoalLinksToTravel', async () => {
    const user = userEvent.setup();
    render(<GoalsPage />);
    const link = await screen.findByRole('link', { name: /Managed in Travel/ });
    expect(link).toHaveAttribute('href', '/travel?year=2026');
    expect(screen.queryByText(/Unknown account/)).not.toBeInTheDocument();

    await user.click(screen.getByText('Test Travel 2026'));
    expect(screen.queryByText('Edit Goal')).not.toBeInTheDocument();

    await user.click(screen.getByText('Test Food'));
    expect(screen.getByText('Edit Goal')).toBeInTheDocument();
  });
});
