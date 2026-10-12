import { describe, it, expect } from 'vitest';
import { squarify, tileBackground } from '@/components/investments/treemap';

describe('squarify', () => {
  it('splits two equal values into two squares', () => {
    expect(
      squarify(
        [
          { key: 'a', value: 1 },
          { key: 'b', value: 1 },
        ],
        200,
        100
      )
    ).toEqual([
      { key: 'a', x: 0, y: 0, w: 100, h: 100 },
      { key: 'b', x: 100, y: 0, w: 100, h: 100 },
    ]);
  });

  it('fills the box exactly, largest first, ignoring empty values', () => {
    const tiles = squarify(
      [
        { key: 's', value: 1 },
        { key: 'l', value: 6 },
        { key: 'm', value: 3 },
        { key: 'z', value: 0 },
      ],
      300,
      200
    );
    expect(tiles.map((t) => t.key)).toEqual(['l', 'm', 's']);
    const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0);
    expect(area).toBeCloseTo(60_000);
    for (const t of tiles) {
      expect(t.x + t.w).toBeLessThanOrEqual(300.0001);
      expect(t.y + t.h).toBeLessThanOrEqual(200.0001);
    }
  });

  it('returns nothing for an empty box or no value', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([{ key: 'a', value: 1 }], 0, 100)).toEqual([]);
  });
});

describe('tileBackground', () => {
  it('is neutral without a market change and deepens with the size of the move', () => {
    expect(tileBackground(null)).toBe('var(--bg-elevated)');
    expect(tileBackground(0)).toBe('color-mix(in srgb, var(--green) 14%, var(--bg-card))');
    expect(tileBackground(-24)).toBe('color-mix(in srgb, var(--red) 60%, var(--bg-card))');
    expect(tileBackground(6)).toBe('color-mix(in srgb, var(--green) 37%, var(--bg-card))');
  });
});
