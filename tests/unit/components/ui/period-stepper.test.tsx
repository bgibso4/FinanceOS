import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodStepper, MonthGrid, YearList } from '@/components/ui/period-stepper';

const setup = (props: Partial<React.ComponentProps<typeof PeriodStepper>> = {}) => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  render(
    <PeriodStepper
      label="Q4 2026"
      nextDisabled={false}
      onNext={onNext}
      onPrev={onPrev}
      {...props}
    />
  );
  return { onPrev, onNext };
};

describe('PeriodStepper', () => {
  it('arrowsCallHandlers', async () => {
    const { onPrev, onNext } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('nextDisabledBlocksClick', async () => {
    const { onNext } = setup({ nextDisabled: true });
    const next = screen.getByRole('button', { name: 'Next period' });
    expect(next).toBeDisabled();
    await userEvent.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('labelOpensPopoverAndPickCloses', async () => {
    setup({
      popover: (close) => <button onClick={close}>Pick</button>,
    });
    expect(screen.queryByRole('button', { name: 'Pick' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Q4 2026/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick' }));
    expect(screen.queryByRole('button', { name: 'Pick' })).toBeNull();
  });

  it('labelClickOverrideSkipsPopover', async () => {
    const onLabelClick = vi.fn();
    setup({ onLabelClick, popover: () => <span>Popover</span> });
    await userEvent.click(screen.getByRole('button', { name: /Q4 2026/ }));
    expect(onLabelClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Popover')).toBeNull();
  });
});

describe('MonthGrid and YearList', () => {
  it('monthGridPicksAndDisablesFuture', async () => {
    const onPick = vi.fn();
    render(<MonthGrid today={new Date(2026, 10, 4)} value="2026-11" onPick={onPick} />);
    expect(screen.getByRole('button', { name: 'Dec' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Oct' }));
    expect(onPick).toHaveBeenCalledWith('2026-10');
  });

  it('yearListPicks', async () => {
    const onPick = vi.fn();
    render(<YearList value="2026" years={['2025', '2026']} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(onPick).toHaveBeenCalledWith('2025');
  });
});
