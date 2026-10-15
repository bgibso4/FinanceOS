import { describe, it, expect } from 'vitest';
import {
  chartGeometry,
  GRIDLINES,
  gridValues,
  nearestIndex,
  tooltipSide,
} from '@/components/investments/chart-geometry';

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

describe('chartGeometry lead', () => {
  it('leaves the lead empty and closes the area under the first point', () => {
    const g = chartGeometry(
      [
        { value: 1, isEstimated: false },
        { value: 2, isEstimated: false },
      ],
      { width: 100, height: 50, pad: 0, lead: 2 }
    )!;
    expect(g.points.map((p) => p.x)).toEqual([66.67, 100]);
    expect(g.area.endsWith('L100,50L66.67,50Z')).toBe(true);
  });
});

describe('nearestIndex', () => {
  it('snaps to the nearest point and clamps to the ends', () => {
    expect(nearestIndex(0.5, 3)).toBe(1);
    expect(nearestIndex(0, 3)).toBe(0);
    expect(nearestIndex(1.4, 3)).toBe(2);
  });
  it('is null over the empty lead', () => {
    expect(nearestIndex(0.1, 3, 10)).toBeNull();
    expect(nearestIndex(0.9, 3, 10)).toBe(1);
  });
});

describe('tooltipSide', () => {
  it('flips left near the right edge', () => {
    expect(tooltipSide(0.5)).toBe('right');
    expect(tooltipSide(0.8)).toBe('left');
  });
});

describe('gridValues', () => {
  it('gives the value at each gridline, top to bottom, inverting the plot', () => {
    const box = { width: 100, height: 120, pad: 10 };
    const g = chartGeometry([p(0), p(100)], box)!;
    expect(GRIDLINES).toEqual([0.25, 0.5, 0.75]);
    expect(gridValues(g, box).map((v) => Number(v.toFixed(6)))).toEqual([80, 50, 20]);
  });

  it('follows a lowered floor', () => {
    const box = { width: 100, height: 100, pad: 0, yMin: 0 };
    const g = chartGeometry([p(100), p(100)], box)!;
    expect(gridValues(g, box).map((v) => Number(v.toFixed(6)))).toEqual([75, 50, 25]);
  });
});
