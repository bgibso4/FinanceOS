import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { BudgetBanner } from '@/components/travel/budget-banner';

const KEY = 'travelBudgetBannerSnoozedUntil';
const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }));

describe('BudgetBanner', () => {
  beforeEach(() => {
    pathname = '/';
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('showsWhenNoBudget', async () => {
    respond({ year: 2026, hasBudget: false });
    render(<BudgetBanner />);
    const link = await screen.findByRole('link', { name: 'Set your 2026 travel budget' });
    expect(link).toHaveAttribute('href', '/travel?year=2026');
  });

  it('hiddenWhenBudgetSet', async () => {
    respond({ year: 2026, hasBudget: true });
    render(<BudgetBanner />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('notNowHidesForFourteenDays', async () => {
    respond({ year: 2026, hasBudget: false });
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { unmount } = render(<BudgetBanner />);
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(KEY))).toBe(NOW.getTime() + 14 * DAY);
    unmount();

    render(<BudgetBanner />);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    vi.setSystemTime(NOW.getTime() + 15 * DAY);
    render(<BudgetBanner />);
    expect(await screen.findByRole('link')).toBeInTheDocument();
  });

  it('hiddenOnTravelPage', async () => {
    pathname = '/travel';
    respond({ year: 2026, hasBudget: false });
    render(<BudgetBanner />);
    await Promise.resolve();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('disappearsAfterBudgetSetOnTravelPage', async () => {
    pathname = '/travel';
    respond({ year: 2026, hasBudget: false });
    const { rerender } = render(<BudgetBanner />);
    expect(fetch).not.toHaveBeenCalled();

    pathname = '/goals';
    rerender(<BudgetBanner />);
    expect(await screen.findByRole('link')).toBeInTheDocument();

    pathname = '/travel';
    rerender(<BudgetBanner />);
    respond({ year: 2026, hasBudget: true });
    pathname = '/goals';
    rerender(<BudgetBanner />);
    await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument());
  });

  it('showsNothingAndWarnsWhenStatusFails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    respond({}, false);
    render(<BudgetBanner />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    warn.mockRestore();
  });
});
