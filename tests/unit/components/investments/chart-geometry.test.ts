import { describe, it, expect } from 'vitest';
import { chartGeometry } from '@/components/investments/chart-geometry';

const p = (value: number, isEstimated = false) => ({ value, isEstimated });

describe('chartGeometry', () => {
  it('needs two points', () => {
    expect(chartGeometry([p(1)], { width: 100, height: 10, pad: 0 })).toBeNull();
  });

  it('maps values into the box, dashing segments that touch an estimate', () => {
    const g = chartGeometry([p(0), p(10), p(10, true), p(0)], { width: 90, height: 10, pad: 0 })!;
    expect(g.points).toEqual([
      { x: 0, y: 10 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 10 },
    ]);
    expect(g.solid).toBe('M0,10L30,0');
    expect(g.dashed).toBe('M30,0L60,0M60,0L90,10');
    expect(g.area).toBe('M0,10L30,0L60,0L90,10L90,10L0,10Z');
  });

  it('lowers the floor to yMin and centres a flat series', () => {
    const floored = chartGeometry([p(100), p(100)], { width: 10, height: 10, pad: 0, yMin: 80 })!;
    expect(floored.points.map((pt) => pt.y)).toEqual([0, 0]);
    const flat = chartGeometry([p(5), p(5)], { width: 10, height: 10, pad: 0 })!;
    expect(flat.points.map((pt) => pt.y)).toEqual([10, 10]);
  });
});
