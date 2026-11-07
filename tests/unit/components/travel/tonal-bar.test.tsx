import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TonalBar, tonalShade } from '@/components/travel/tonal-bar';
import type { CategorySlice } from '@/lib/travel/types';

const slice = (name: string, share: number): CategorySlice => ({
  categoryId: name,
  name,
  spend: share * 1000,
  share,
});

describe('tonalShade', () => {
  it('tonalShadeStrengthsByRank', () => {
    const mix = (p: number) => `color-mix(in srgb, var(--accent) ${p}%, var(--bg-card))`;
    expect([0, 1, 2, 3, 4].map(tonalShade)).toEqual([100, 68, 44, 26, 14].map(mix));
    expect(tonalShade(9)).toBe(mix(14));
  });
});

describe('TonalBar', () => {
  const slices = [
    slice('Test Food', 0.5),
    slice('Test Lodging', 0.25),
    slice('Test Gas', 0.15),
    slice('Test Spa', 0.1),
  ];

  it('aCategoryWithNoShareGetsNoSegmentOrLegend', () => {
    const { container } = render(
      <TonalBar slices={[slice('Test Food', 1), slice('Test Credit', 0)]} />
    );
    expect(container.querySelectorAll('[data-segment]')).toHaveLength(1);
    expect(screen.queryByText(/Test Credit/)).toBeNull();
  });

  it('legendShowsTopThree', () => {
    render(<TonalBar slices={slices} />);
    expect(screen.getByText('Test Food 50%')).toBeInTheDocument();
    expect(screen.getByText('Test Lodging 25%')).toBeInTheDocument();
    expect(screen.getByText('Test Gas 15%')).toBeInTheDocument();
    expect(screen.queryByText(/Test Spa/)).not.toBeInTheDocument();
  });

  it('segmentsFollowRankAndShare', () => {
    const { container } = render(<TonalBar slices={slices} />);
    const segments = container.querySelectorAll<HTMLElement>('[data-segment]');
    expect(segments).toHaveLength(4);
    expect(segments[0].style.width).toBe('50%');
    expect(segments[0].style.background).toContain('100%');
    expect(segments[3].style.width).toBe('10%');
    expect(segments[3].style.background).toContain('26%');
  });
});
