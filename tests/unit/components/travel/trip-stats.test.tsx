import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryBreakdown } from '@/components/travel/trip-stats';
import type { TripSummary } from '@/lib/travel/types';

const trip = {
  categories: [
    { categoryId: 'food', name: 'Test Food', spend: 50, share: 1 },
    { categoryId: 'flights', name: 'Test Flights', spend: -30, share: 0 },
  ],
} as TripSummary;

describe('CategoryBreakdown', () => {
  it('aNetCreditShowsNegativeWithAnEmptyBar', () => {
    render(<CategoryBreakdown currency="USD" trip={trip} />);
    expect(screen.getByText('−$30')).toBeInTheDocument();
    const row = screen.getByText('Test Flights').parentElement!.parentElement!;
    expect(row.querySelector('i')).toHaveStyle({ width: '0%' });
  });
});
