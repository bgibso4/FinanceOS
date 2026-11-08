import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoTip } from '@/components/ui/info-tip';

function setup(align?: 'start' | 'end') {
  render(
    <InfoTip align={align} text="Explains the column">
      Annual
    </InfoTip>
  );
  return screen.getByText('Annual');
}

describe('InfoTip', () => {
  it('hidesTipUntilHoveredOrFocused', () => {
    setup();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('showsOnHoverAndHidesOnLeave', async () => {
    const trigger = setup();
    await userEvent.hover(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explains the column');
    await userEvent.unhover(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('showsOnFocusAndHidesOnBlur', async () => {
    const trigger = setup();
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hidesOnEscape', async () => {
    const trigger = setup();
    await userEvent.hover(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('wiresAriaDescribedByToTheTooltipId', async () => {
    const trigger = setup();
    expect(trigger).not.toHaveAttribute('aria-describedby');
    await userEvent.hover(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
  });

  it('alignsTheTooltipToTheEndEdge', async () => {
    const trigger = setup('end');
    await userEvent.hover(trigger);
    expect(screen.getByRole('tooltip').style.right).toBe('0px');
  });

  it('placesTheTooltipBelowSoTheCardEdgeDoesNotClipIt', async () => {
    const trigger = setup();
    await userEvent.hover(trigger);
    const style = screen.getByRole('tooltip').style;
    expect(style.top).toContain('100%');
    expect(style.bottom).toBe('');
  });
});
