import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionCards } from '@/components/ui/option-cards';

const options = [
  { value: 'valued', title: 'Valued', description: 'From holdings' },
  { value: 'manual', title: 'Manual', description: 'Typed in' },
  { value: 'synced', title: 'Synced', description: 'From connection', disabled: true },
];

describe('OptionCards', () => {
  it('marks the selected card and reports a choice', async () => {
    const onChange = vi.fn();
    render(<OptionCards label="Source" options={options} value="valued" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Valued/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /Manual/ }));
    expect(onChange).toHaveBeenCalledWith('manual');
  });

  it('a disabled card cannot be chosen', async () => {
    const onChange = vi.fn();
    render(<OptionCards label="Source" options={options} value="valued" onChange={onChange} />);
    const card = screen.getByRole('radio', { name: /Synced/ });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(card);
    expect(onChange).not.toHaveBeenCalled();
  });
});
