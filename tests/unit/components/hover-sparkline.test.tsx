import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HoverSparkline } from '@/components/ui/hover-sparkline';

const points = [
  { label: 'Jan 2026', value: 1 },
  { label: 'Feb 2026', value: 3 },
  { label: 'Mar 2026', value: 2 },
];
const format = (v: number) => `${v}%`;

function setup(pts = points) {
  render(<HoverSparkline format={format} label="Past year" points={pts} />);
  const box = screen.getByLabelText('Past year');
  box.getBoundingClientRect = () =>
    ({
      left: 100,
      width: 200,
      right: 300,
      top: 0,
      bottom: 26,
      height: 26,
      x: 100,
      y: 0,
    }) as DOMRect;
  return box;
}

describe('HoverSparkline', () => {
  it('rendersPath', () => {
    const box = setup();
    expect(box.querySelectorAll('path')).toHaveLength(2);
    expect(box.querySelector('path[d^="M"]')).not.toBeNull();
  });

  it('hoverShowsNearestPoint', () => {
    const box = setup();
    fireEvent.pointerMove(box, { clientX: 100 });
    expect(screen.getByText('Jan 2026 · 1%')).toBeInTheDocument();
    fireEvent.pointerMove(box, { clientX: 300 });
    expect(screen.getByText('Mar 2026 · 2%')).toBeInTheDocument();
    expect(screen.queryByText('Jan 2026 · 1%')).toBeNull();
  });

  it('leaveHidesTooltip', () => {
    const box = setup();
    fireEvent.pointerMove(box, { clientX: 200 });
    expect(screen.getByText('Feb 2026 · 3%')).toBeInTheDocument();
    fireEvent.pointerLeave(box);
    expect(screen.queryByText(/ · /)).toBeNull();
  });

  it('tooFewPointsRendersPlaceholder', () => {
    const box = setup([points[0]]);
    expect(box.querySelector('svg')).toBeNull();
    expect(box).toHaveStyle({ height: '26px' });
  });
});
